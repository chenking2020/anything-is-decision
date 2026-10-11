"""本体层：数据汇聚 → 自动构建本体图 → 动态子本体裁剪。

为什么需要这一层
----------------
决策引擎（laya）接受的是一份「状态」，它只读得懂眼前这段文字。
但真实输入从来不是一段文字：它是多个数据源拼起来的——工单正文、用户画像、
交易记录、历史工单、告警上下文。把这些东西简单地拼成一个字符串，
模型会读到一团噪声；而**先把它组织成一张图**，每个决策因子再按自己的需要
从图上裁一小块（动态子本体）来读，信号密度就完全不同。

本模块做三件事，全部离线、纯 Python、无外部依赖、无 LLM 调用：

1. ``aggregate``   —— 数据汇聚：把 str / dict / list / 多份数据源统一成文档集 + 属性表。
2. ``build_ontology`` —— 自动构本体：结构化字段 → 属性节点；文本 → 短语级概念节点 +
   共现关系边；得到一个带权本体图。
3. ``subgraph``     —— 动态子本体：给一组种子（因子关心的类型/关键词/上游结论），
   按 k 跳邻域裁出子图，再 ``render`` 成模型读得懂的文本。

设计上刻意**不做**的事：不做实体链接、不做指代消解、不猜测 schema。
它是「把原始材料摊开成图」，而不是「理解世界」——理解发生在决策头里，
且以概率的形式被记录、被门控。
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union

State = Union[str, Dict[str, Any], List[Any]]

# ───────────────────────── 停用词与分句 ─────────────────────────

# 中文虚词 + 高频代词/礼貌用语：用作短语切分的分隔符
STOPWORDS_ZH = {
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "也", "很", "到", "说", "要",
    "去", "会", "着", "看", "好", "这", "那", "吗", "呢", "吧", "啊", "请", "您", "谢谢",
    "我们", "你们", "他们", "她们", "它们", "自己", "这个", "那个", "什么", "怎么", "怎样",
    "因为", "所以", "但是", "如果", "已经", "对于", "以及", "通过", "及其", "其他", "一些",
    "这些", "那些", "可以", "需要", "还是", "一个", "没有", "不是", "就是", "而且", "然后",
    "目前", "现在", "今天", "明天", "昨天", "之前", "之后", "一直", "非常", "特别", "真的",
    "能否", "是否", "希望", "要求", "请问", "你好", "您好", "谢谢", "感谢",
    # 单字虚词/量词/时间词：它们会把短语切碎，也会自己变成噪音概念
    "上", "下", "前", "后", "里", "中", "个", "被", "把", "让", "给", "对", "向", "从",
    "等", "再", "又", "还", "只", "太", "更", "最", "过", "时", "老", "新", "两", "几",
    "年", "月", "日", "号", "次", "笔", "元", "块", "点", "分", "秒", "件", "条", "位",
    "否则", "共计", "另外", "同时", "并且", "因此", "于是", "随后", "比如", "例如", "关于",
}

STOPWORDS_EN = {
    "the", "a", "an", "and", "or", "but", "if", "is", "are", "was", "were", "be", "been",
    "to", "of", "in", "on", "at", "for", "with", "as", "by", "it", "this", "that", "these",
    "those", "i", "you", "he", "she", "we", "they", "my", "your", "his", "her", "our",
    "their", "have", "has", "had", "do", "does", "did", "will", "would", "can", "could",
    "please", "thanks", "thank", "hi", "hello", "dear", "from", "not", "no", "yes",
}

_SENT_SPLIT = re.compile(r"[。！？；!?;\n\r]+|[.](?=\s|$)")
_CN_RUN = re.compile(r"[\u4e00-\u9fff]{2,}")
_EN_WORD = re.compile(r"[A-Za-z][A-Za-z\-']{3,}")  # 英文词至少 4 个字母，3 个字母的多半是缩写/噪音
_STOP_RE = re.compile("|".join(sorted(STOPWORDS_ZH, key=len, reverse=True)))


def _sentences(text: str) -> List[str]:
    return [s.strip() for s in _SENT_SPLIT.split(text or "") if s and s.strip()]


def _phrases(text: str) -> List[str]:
    """从一段文本里切出中文短语 + 英文词。

    中文策略：先取连续汉字段，再用停用词切分，剩下的片段（长度 2–12）即为短语候选。
    这比 n-gram 滑窗干净得多——滑窗会产生大量无意义的跨词组合。
    """
    out: List[str] = []
    for run in _CN_RUN.findall(text or ""):
        for part in _STOP_RE.split(run):
            part = part.strip()
            if 2 <= len(part) <= 12:
                out.append(part)
    for w in _EN_WORD.findall(text or ""):
        low = w.lower()
        if low not in STOPWORDS_EN and len(low) >= 3:
            out.append(low)
    return out


# ───────────────────────── 图结构 ─────────────────────────


@dataclass
class Node:
    id: str
    type: str  # root | document | attribute | concept | conclusion
    label: str
    value: str = ""
    weight: float = 1.0
    step: int = 0
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "label": self.label,
            "value": self.value,
            "weight": round(self.weight, 4),
            "step": self.step,
            "meta": self.meta,
        }


@dataclass
class Edge:
    source: str
    target: str
    rel: str  # has | mentions | co_occurs | derives | about
    weight: float = 1.0
    step: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "target": self.target,
            "rel": self.rel,
            "weight": round(self.weight, 4),
            "step": self.step,
        }


class OntologyGraph:
    """一张带权本体图。纯内存结构，可序列化成 dict 给前端画。"""

    def __init__(self) -> None:
        self.nodes: Dict[str, Node] = {}
        self.edges: List[Edge] = []
        self._adj: Dict[str, List[Tuple[str, str, float]]] = {}

    # ── 写 ──

    def add_node(self, node_id: str, type: str, label: str, *, value: str = "",
                 weight: float = 1.0, step: int = 0, **meta: Any) -> Node:
        cur = self.nodes.get(node_id)
        if cur is not None:
            cur.weight += weight
            if value and not cur.value:
                cur.value = value
            cur.meta.update(meta)
            return cur
        node = Node(node_id, type, label, value=value, weight=weight, step=step, meta=dict(meta))
        self.nodes[node_id] = node
        self._adj.setdefault(node_id, [])
        return node

    def add_edge(self, source: str, target: str, rel: str, *, weight: float = 1.0,
                 step: int = 0) -> Optional[Edge]:
        if source not in self.nodes or target not in self.nodes or source == target:
            return None
        # 同关系重复边：累加权重而不是再连一条
        for e in self.edges:
            if e.source == source and e.target == target and e.rel == rel:
                e.weight += weight
                return e
        edge = Edge(source, target, rel, weight=weight, step=step)
        self.edges.append(edge)
        self._adj.setdefault(source, []).append((target, rel, weight))
        self._adj.setdefault(target, []).append((source, rel, weight))
        return edge

    # ── 读 ──

    def neighbors(self, node_id: str) -> List[Tuple[str, str, float]]:
        return list(self._adj.get(node_id, []))

    def subgraph(self, seeds: Sequence[str], *, depth: int = 1, limit: int = 24) -> "OntologyGraph":
        """以 seeds 为中心按 k 跳邻域裁出子图（动态子本体）。

        节点上限触发时按权重降序保留——因子看的是最相关的那一小块，
        而不是全图；这正是「动态子本体」相对「一个世界模型」的差别。
        """
        out = OntologyGraph()
        if not seeds:
            return out
        frontier = [s for s in seeds if s in self.nodes]
        seen: Dict[str, int] = {}
        for s in frontier:
            seen[s] = 0
        for _ in range(max(0, int(depth))):
            nxt: List[str] = []
            for nid in frontier:
                for nb, _rel, _w in sorted(self.neighbors(nid), key=lambda x: -x[2]):
                    if nb not in seen:
                        seen[nb] = seen[nid] + 1
                        nxt.append(nb)
            frontier = nxt
            if not frontier:
                break
        keep = sorted(seen.items(), key=lambda kv: (kv[1], -self.nodes[kv[0]].weight))
        keep = keep[: max(1, int(limit))]
        keep_ids = {k for k, _ in keep}
        for k, _ in keep:
            n = self.nodes[k]
            out.add_node(n.id, n.type, n.label, value=n.value, weight=n.weight, step=n.step, **n.meta)
        for e in self.edges:
            if e.source in keep_ids and e.target in keep_ids:
                out.add_edge(e.source, e.target, e.rel, weight=e.weight, step=e.step)
        return out

    def seeds_for(self, scope: Optional[Dict[str, Any]] = None, *,
                  keywords: Optional[Sequence[str]] = None,
                  types: Optional[Sequence[str]] = None,
                  limit: int = 8) -> List[str]:
        """把因子的 scope 解析成种子节点 id 列表。

        scope 形如 ``{"types": ["attribute"], "keywords": ["退款"], "depth": 2}``。
        keywords 支持子串匹配（中文场景下精确相等几乎不命中）。
        """
        scope = scope or {}
        want_types = set(types or scope.get("types") or [])
        want_kw = [str(k) for k in (keywords or scope.get("keywords") or []) if str(k).strip()]
        seeds: List[str] = []
        if want_types:
            seeds += [n.id for n in self.nodes.values() if n.type in want_types]
        for kw in want_kw:
            low = kw.lower()
            for n in self.nodes.values():
                if low in n.label.lower() or low in str(n.value).lower():
                    seeds.append(n.id)
        if not seeds:
            # 没给 scope：退化为「全图按权重取头部节点」
            seeds = [
                n.id
                for n in sorted(self.nodes.values(), key=lambda x: -x.weight)
                if n.type in ("concept", "attribute")
            ][:limit]
        # 去重保序
        out: List[str] = []
        for s in seeds:
            if s not in out:
                out.append(s)
        return out[: max(1, limit)]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": [n.to_dict() for n in self.nodes.values()],
            "edges": [e.to_dict() for e in self.edges],
        }

    def __len__(self) -> int:
        return len(self.nodes)


# ───────────────────────── 数据汇聚 ─────────────────────────


@dataclass
class Doc:
    id: str
    text: str
    meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DataBundle:
    """汇聚结果：若干文档 + 结构化属性表。"""

    docs: List[Doc] = field(default_factory=list)
    attributes: List[Tuple[str, str]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "docs": [{"id": d.id, "text": d.text, "meta": d.meta} for d in self.docs],
            "attributes": [{"key": k, "value": v} for k, v in self.attributes],
        }


def _flatten(prefix: str, value: Any, out: List[Tuple[str, str]], depth: int = 0) -> None:
    if depth > 4:
        return
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten(f"{prefix}.{k}" if prefix else str(k), v, out, depth + 1)
    elif isinstance(value, (list, tuple)):
        for i, v in enumerate(value):
            _flatten(f"{prefix}[{i}]", v, out, depth + 1)
    else:
        out.append((prefix or "value", str(value)))


def aggregate(state: Any = None, sources: Optional[List[Dict[str, Any]]] = None) -> DataBundle:
    """把各种形态的输入汇聚成一个 bundle。

    * ``sources``（可选）：``[{"id": "...", "text": "..."} | {"id": "...", "data": {...}}]``
      多条数据源，每条既贡献文档也贡献属性。
    * ``state``：兼容既有调用方式——字符串 / dict / list。
    """
    bundle = DataBundle()
    src_list: List[Dict[str, Any]] = []
    if sources:
        src_list.extend(sources)
    elif state is not None:
        if isinstance(state, dict) and isinstance(state.get("sources"), list):
            src_list.extend(state["sources"])
        else:
            src_list.append({"id": "state", "data": state})

    for i, src in enumerate(src_list):
        sid = str(src.get("id") or f"src-{i+1}")
        meta = {k: v for k, v in src.items() if k not in ("id", "text", "data")}
        if src.get("text") is not None:
            bundle.docs.append(Doc(sid, str(src["text"]), meta))
        data = src.get("data")
        if data is None and "text" not in src:
            data = src
        if isinstance(data, (dict, list)):
            flat: List[Tuple[str, str]] = []
            _flatten("", data, flat)
            for k, v in flat:
                bundle.attributes.append((f"{sid}:{k}" if k else sid, v))
            bundle.docs.append(Doc(sid, _textify(data), meta))
        elif isinstance(data, str):
            bundle.docs.append(Doc(sid, data, meta))
        elif data is not None and "text" not in src:
            bundle.docs.append(Doc(sid, str(data), meta))
    return bundle


def _textify(data: Any) -> str:
    if isinstance(data, str):
        return data
    if isinstance(data, dict):
        return "；".join(f"{k}：{_textify(v)}" for k, v in data.items())
    if isinstance(data, (list, tuple)):
        return "；".join(_textify(v) for v in data)
    return str(data)


# ───────────────────────── 自动构本体 ─────────────────────────


def build_ontology(bundle: DataBundle, *, top_concepts: int = 40,
                   max_edges_per_sentence: int = 8) -> OntologyGraph:
    """从汇聚后的数据自动构建本体图。

    三类节点：
      * ``root``      —— 本次决策的根（一条状态一个）
      * ``document``  —— 每个数据源
      * ``attribute`` —— 结构化字段（来自 dict / JSON）
      * ``concept``   —— 从文本里抽出的短语级概念（带 tf/df 权重）

    三类边：
      * ``has``       —— root → document / attribute（结构关系）
      * ``mentions``  —— document → concept（这个数据源提到了这个概念）
      * ``co_occurs`` —— concept ↔ concept（同一句里共现，权重 = 共现次数）
    """
    g = OntologyGraph()
    root = g.add_node("root", "root", "状态", value="本次决策的输入根")

    for doc in bundle.docs:
        dnode = g.add_node(f"doc:{doc.id}", "document", doc.id, value=doc.text[:400], **doc.meta)
        g.add_edge(root.id, dnode.id, "has", weight=1.0)

    for key, value in bundle.attributes:
        anode = g.add_node(f"attr:{key}", "attribute", key, value=value[:400])
        g.add_edge(root.id, anode.id, "has", weight=1.0)

    # 结构化字段的键名不是概念（tenure_months / mrr 这种会被当成短语混进来）
    structural = _structural_terms(bundle)

    # ── 概念抽取：tf / df 统计 ──
    tf: Dict[str, int] = {}
    df: Dict[str, int] = {}
    doc_hits: Dict[str, Dict[str, int]] = {}
    for doc in bundle.docs:
        hits: Dict[str, int] = {}
        for sent in _sentences(doc.text):
            seen = set()
            for ph in _phrases(sent):
                if ph.lower() in structural:
                    continue
                tf[ph] = tf.get(ph, 0) + 1
                hits[ph] = hits.get(ph, 0) + 1
                seen.add(ph)
            for ph in seen:
                df[ph] = df.get(ph, 0) + 1
        doc_hits[doc.id] = hits

    # 子串抑制：「扣款」若几乎总是出现在「重复扣款」里，就丢掉更短的那个
    ranked = _suppress_substrings(tf)
    ranked = ranked[: max(1, int(top_concepts))]

    concept_ids: Dict[str, str] = {}
    for ph in ranked:
        nid = f"concept:{ph}"
        weight = float(tf.get(ph, 1)) * (1.0 + math.log1p(df.get(ph, 1)))
        g.add_node(nid, "concept", ph, weight=weight, tf=tf.get(ph, 1), df=df.get(ph, 1))
        concept_ids[ph] = nid
        for doc in bundle.docs:
            n = doc_hits.get(doc.id, {}).get(ph, 0)
            if n:
                g.add_edge(f"doc:{doc.id}", nid, "mentions", weight=float(n))

    # 同句共现 → 概念之间的关系边（决策时最有用的一类边：它把「扣款」和「退款」连起来）
    concept_set = set(concept_ids)
    for doc in bundle.docs:
        for sent in _sentences(doc.text):
            present = [p for p in set(_phrases(sent)) if p in concept_set]
            present.sort(key=lambda p: -tf.get(p, 0))
            present = present[:max_edges_per_sentence]
            for i in range(len(present)):
                for j in range(i + 1, len(present)):
                    g.add_edge(concept_ids[present[i]], concept_ids[present[j]], "co_occurs", weight=1.0)
    return g


def _structural_terms(bundle: "DataBundle") -> set:
    """结构化字段键名（含下划线切分后的段落）算作结构词，不进概念集。"""
    out: set = set()
    for key, _v in bundle.attributes:
        tail = str(key).split(":")[-1]
        for seg in re.split(r"[^0-9A-Za-z\u4e00-\u9fff]+", tail):
            if seg:
                out.add(seg.lower())
                out.add(seg)
    return out


def _suppress_substrings(tf: Dict[str, int]) -> List[str]:
    """按 (tf, 长度) 排序，并抑制被更长短语包含的短短语。"""
    items = sorted(tf.items(), key=lambda kv: (-kv[1], -len(kv[0]), kv[0]))
    kept: List[str] = []
    for ph, cnt in items:
        if any(ph != k and ph in k and cnt <= tf.get(k, 0) * 1.5 for k in kept):
            continue
        kept.append(ph)
    return kept


# ───────────────────────── 结论回写 ─────────────────────────


def add_conclusion(g: OntologyGraph, key: str, text: str, *, confidence: float = 0.0,
                   seeds: Sequence[str] = (), step: int = 0, gate: str = "") -> Node:
    """把一个决策因子的结论写成结论节点，并从它的依据连 derives 边。

    这一步是整个链路的关键：**上游结论变成图上的节点**，
    下游因子裁子图时自然就把它读进去了——链式依赖不需要额外的管道。
    """
    nid = f"conclusion:{key}"
    node = g.add_node(
        nid, "conclusion", key, value=text, weight=1.0 + max(0.0, float(confidence)), step=step,
        confidence=round(float(confidence), 4), gate=gate,
    )
    node.value = text
    node.meta["confidence"] = round(float(confidence), 4)
    node.meta["gate"] = gate
    for s in seeds:
        g.add_edge(nid, s, "derives", weight=1.0, step=step)
    return node


# ───────────────────────── 渲染 ─────────────────────────


def render(g: OntologyGraph, *, include_types: Sequence[str] = ("attribute", "concept", "conclusion"),
           max_nodes: int = 30, max_edges: int = 40) -> str:
    """把（子）图渲染成模型读得懂的一段中文文本。

    顺序固定（属性 → 结论 → 概念 → 关系），保证同一份输入永远得到同一份文本——
    决策引擎是非自回归的，可复现性依赖输入文本的可复现。
    """
    types = set(include_types)
    nodes = [n for n in g.nodes.values() if n.type in types]
    nodes.sort(key=lambda n: ({"attribute": 0, "conclusion": 1, "concept": 2}.get(n.type, 3), -n.weight, n.id))
    nodes = nodes[:max_nodes]
    keep = {n.id for n in nodes}

    lines: List[str] = []
    groups = [
        ("attribute", "【属性】"),
        ("conclusion", "【已判定】"),
        ("concept", "【概念】"),
    ]
    for t, title in groups:
        items = [n for n in nodes if n.type == t]
        if not items:
            continue
        lines.append(title)
        for n in items:
            val = (n.value or "").strip().replace("\n", " ")
            if len(val) > 160:
                val = val[:160] + "…"
            lines.append(f"- {n.label}：{val}" if val else f"- {n.label}")
    edges = [e for e in g.edges if e.source in keep and e.target in keep]
    rels = [e for e in edges if e.rel in ("co_occurs", "derives")]
    rels.sort(key=lambda e: (-e.weight, e.source, e.target))
    if rels:
        lines.append("【关系】")
        for e in rels[:max_edges]:
            s = g.nodes.get(e.source)
            t = g.nodes.get(e.target)
            if not s or not t:
                continue
            verb = "共现于" if e.rel == "co_occurs" else "依据"
            lines.append(f"- {s.label} {verb} {t.label}")
    return "\n".join(lines)


def graph_stats(g: OntologyGraph) -> Dict[str, int]:
    by_type: Dict[str, int] = {}
    for n in g.nodes.values():
        by_type[n.type] = by_type.get(n.type, 0) + 1
    by_rel: Dict[str, int] = {}
    for e in g.edges:
        by_rel[e.rel] = by_rel.get(e.rel, 0) + 1
    return {"nodes": len(g.nodes), "edges": len(g.edges), "by_type": by_type, "by_rel": by_rel}
