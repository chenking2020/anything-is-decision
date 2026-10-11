"""链式编排器：汇聚数据 → 构本体 → 按因子裁子本体 → 链式多步决策 → 收敛成结论。

一次蓝图执行的完整形态
----------------------
1. **汇聚数据**：把多条数据源（正文、画像、历史记录、交易流水）聚成一个 bundle。
2. **构建本体**：把 bundle 自动摊成一张本体图（属性节点 + 概念节点 + 共现边）。
3. **因子分层**：每个决策因子可以声明 ``depends_on``（我依赖哪些因子的结论）
   和 ``scope``（我只关心图上哪些类型/关键词）。按依赖做拓扑分层。
4. **动态子本体**：执行某个因子时，从全图裁出「它依赖的上游结论节点 + 它 scope
   命中的节点」的 k 跳邻域——这就是动态子本体。同一个状态上，不同因子读到的
   是不同的子图。
5. **链式推进**：上游结论被写成 ``conclusion`` 节点回写到图上，下游因子裁子图时
   自然读到它。依赖不是靠参数传递，而是靠图上多出来的那一个节点。
6. **多步迭代**：重复 3–5 若干轮，直到所有因子的取值稳定（且不再被门控拦下）
   或达到 ``max_steps``。每一步都留下轨迹，可回放、可审计。

为什么要多步：第一轮判「是否疑似钓鱼」可能只有 0.62（勉强过阈），
把它的结论写回图后，第二轮判「用了哪种手法」时读到的子图里多了一个
高置信的结论节点——后验会明显收紧。这就是「多步重复数据 + 本体 + 决策」。
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .config import CHECKPOINT_NAME
from .engine import _answer_text, _verdict
from .ontology import (
    DataBundle,
    OntologyGraph,
    add_conclusion,
    aggregate,
    build_ontology,
    render,
)

# 因子 spec 里的扩展字段（向后兼容：老蓝图没有这些字段时走扁平并行路径）
SCOPE_KEY = "scope"
DEPENDS_KEY = "depends_on"


def _deps(spec: Dict[str, Any]) -> List[str]:
    raw = (spec or {}).get(DEPENDS_KEY) or []
    if isinstance(raw, str):
        return [raw]
    return [str(x) for x in raw]


def topo_layers(factors: Dict[str, Dict[str, Any]]) -> List[List[str]]:
    """按 depends_on 做拓扑分层；同一层内互不依赖，可以共享一次前向。

    循环依赖直接抛错——链式依赖必须是有向无环图，否则「先后顺序」没有定义。
    """
    keys = list(factors.keys())
    known = set(keys)
    indeg: Dict[str, int] = {}
    children: Dict[str, List[str]] = {k: [] for k in keys}
    for k in keys:
        ds = [d for d in _deps(factors[k]) if d in known and d != k]
        indeg[k] = len(ds)
        for d in ds:
            children[d].append(k)

    layers: List[List[str]] = []
    remaining = set(keys)
    while remaining:
        layer = [k for k in keys if k in remaining and indeg[k] == 0]
        if not layer:
            cyc = ", ".join(sorted(remaining))
            raise ValueError(f"决策因子之间存在循环依赖：{cyc}")
        layers.append(layer)
        for k in layer:
            remaining.discard(k)
            for c in children[k]:
                indeg[c] -= 1
    return layers


def _raw_text(bundle: DataBundle, limit: int = 2000) -> str:
    parts: List[str] = []
    for d in bundle.docs:
        t = (d.text or "").strip()
        if not t:
            continue
        parts.append(t if len(t) <= limit else t[:limit] + "…")
    return "\n".join(parts)


def _compose_state(raw: str, sub: OntologyGraph) -> str:
    body = render(sub)
    chunks = []
    if raw:
        chunks.append("【原始数据】\n" + raw)
    if body:
        chunks.append(body)
    return "\n\n".join(chunks)


def run_chain(
    engine: Any,
    state: Any = None,
    factors: Optional[Dict[str, Dict[str, Any]]] = None,
    *,
    sources: Optional[List[Dict[str, Any]]] = None,
    temperature: Optional[Dict[str, float]] = None,
    policy: Optional[Dict[str, Any]] = None,
    max_len: Optional[int] = None,
    max_steps: int = 1,
    depth: int = 1,
    limit: int = 24,
    top_concepts: int = 40,
    include_state_text: bool = True,
) -> Dict[str, Any]:
    """执行一次蓝图级链式决策。返回图、每一步轨迹、最终答案与裁决。"""
    factors = dict(factors or {})
    if not factors:
        raise ValueError("没有决策因子（questions 为空）")
    policy = dict(policy or {})
    threshold = float(policy.get("threshold", 0.60))
    max_steps = max(1, int(max_steps or 1))

    t0 = time.time()

    # 1) 汇聚 + 2) 构本体
    bundle = aggregate(state, sources)
    graph = build_ontology(bundle, top_concepts=top_concepts)
    raw = _raw_text(bundle)

    layers = topo_layers(factors)
    chained = any(_deps(s) for s in factors.values()) or any(
        (s or {}).get(SCOPE_KEY) for s in factors.values()
    )

    answers: Dict[str, Any] = {}
    prev_values: Dict[str, Any] = {}
    steps: List[Dict[str, Any]] = []
    usage_in = usage_out = 0
    round_no = 0
    converged = False
    seq = 0

    # 反向依赖：某个因子变了，谁要跟着重判
    dependents: Dict[str, List[str]] = {}
    for k, spec in factors.items():
        for d in _deps(spec):
            dependents.setdefault(d, []).append(k)

    dirty: set = set(factors)  # 第一轮：全部都判
    unsettled: List[str] = []

    for r in range(1, max_steps + 1):
        round_no = r
        changed_any = False
        changed_keys: List[str] = []

        for li, layer in enumerate(layers):
            todo = [k for k in layer if k in dirty]
            if not todo:
                continue

            # 按渲染出的 state 文本分组：文本相同的因子共享一次前向
            groups: Dict[str, List[str]] = {}
            states: Dict[str, str] = {}
            seeds_map: Dict[str, List[str]] = {}
            sub_map: Dict[str, Any] = {}
            for k in todo:
                spec = factors[k]
                seeds = graph.seeds_for(spec.get(SCOPE_KEY))
                # 关键：上游结论节点强制进种子——链式依赖就落在这一行
                for d in _deps(spec):
                    nid = f"conclusion:{d}"
                    if nid in graph.nodes and nid not in seeds:
                        seeds.append(nid)
                sub = graph.subgraph(seeds, depth=depth, limit=limit)
                st = _compose_state(raw, sub)
                seeds_map[k] = seeds
                sub_map[k] = sub.to_dict()
                states[k] = st
                groups.setdefault(st, []).append(k)

            for st, keys in groups.items():
                qs = {k: factors[k] for k in keys}
                res = engine.predict(
                    st, qs, max_len=max_len, temperature=temperature, policy=policy
                )
                usage = res.get("usage") or {}
                usage_in += int(usage.get("input_tokens") or 0)
                usage_out += int(usage.get("output_tokens") or 0)
                got = res.get("answers") or {}
                for k in keys:
                    ans = got.get(k)
                    if not ans:
                        continue
                    conf = float(ans.get("answer_confidence") or 0.0)
                    text = _answer_text(ans)
                    seq += 1
                    changed = r > 1 and str(prev_values.get(k)) != str(ans.get("value"))
                    if changed:
                        changed_any = True
                        changed_keys.append(k)
                    answers[k] = ans
                    # 5) 结论回写：上游答案变成图上的一个节点
                    add_conclusion(
                        graph, k, text, confidence=conf,
                        seeds=seeds_map.get(k, [])[:8], step=seq,
                        gate=(ans.get("gate") or {}).get("decision", ""),
                    )
                    step_rec: Dict[str, Any] = {
                        "seq": seq,
                        "round": r,
                        "layer": li,
                        "key": k,
                        "seeds": seeds_map.get(k, []),
                        "subgraph": sub_map.get(k, {"nodes": [], "edges": []}),
                        "answer": {
                            "value": ans.get("value"),
                            "display": ans.get("display"),
                            "type": ans.get("type"),
                            "confidence": round(conf, 4),
                            "gate": ans.get("gate"),
                        },
                        "changed": changed,
                    }
                    if include_state_text:
                        step_rec["state_text"] = states.get(k, "")
                    steps.append(step_rec)

        # 6) 收敛判断：下一轮该判谁 = 自身不稳定的 + 上游发生了变化的下游
        prev_values = {k: a.get("value") for k, a in answers.items()}
        unsettled = [k for k in factors if not _is_stable(answers.get(k), None, threshold)]
        if not unsettled:
            converged = True
            break
        if not changed_any and r >= 2:
            # 还在不稳定（多半是被门控拦下），但取值已不再变化 → 再跑也是同样的结果
            converged = False
            break
        dirty = set(unsettled)
        for k in changed_keys:
            dirty.update(dependents.get(k, []))

    confs = [float(a.get("answer_confidence") or 0.0) for a in answers.values()]
    elapsed = (time.time() - t0) * 1000.0
    return {
        "answers": answers,
        "verdict": _verdict(answers),
        "avg_confidence": round(sum(confs) / len(confs), 4) if confs else None,
        "min_confidence": round(min(confs), 4) if confs else None,
        "threshold": threshold,
        "usage": {"input_tokens": usage_in, "output_tokens": usage_out},
        "elapsed_ms": round(elapsed, 2),
        "graph": graph.to_dict(),
        "layers": layers,
        "steps": steps,
        "rounds": round_no,
        "converged": converged,
        "chained": chained,
        "unsettled": sorted(set(unsettled)),
        "model": CHECKPOINT_NAME,
    }


def _is_stable(ans: Optional[Dict[str, Any]], prev_value: Any, threshold: float) -> bool:
    """稳定 = 已出答案 + 置信过阈 + 未被门控拦下。"""
    if not ans:
        return False
    gate = (ans.get("gate") or {}).get("decision", "")
    if gate == "escalate":
        return False
    conf = float(ans.get("answer_confidence") or 0.0)
    if conf < threshold:
        return False
    return True


def plan(factors: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """只做依赖分析，不跑推理（给前端画依赖图 / 检查环）。"""
    try:
        layers = topo_layers(factors)
        error = None
    except ValueError as exc:
        layers = []
        error = str(exc)
    edges = [
        {"from": d, "to": k}
        for k, s in (factors or {}).items()
        for d in _deps(s)
        if d in (factors or {})
    ]
    return {"layers": layers, "edges": edges, "error": error, "count": len(factors or {})}
