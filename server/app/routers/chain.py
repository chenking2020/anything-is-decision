"""本体与链式决策接口。

三条路径：
  * ``POST /api/ontology/build`` —— 只看本体：汇聚数据、构图、返回图（不跑推理）。
  * ``POST /api/chain/plan``     —— 只看依赖：拓扑分层与环检测（不跑推理，亚毫秒）。
  * ``POST /api/decide/chain``   —— 完整链路：汇聚 → 构图 → 逐因子裁子本体 → 链式多步 → 结论。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

from .. import engine as engine_mod
from .. import ontology as onto
from .. import orchestrator as orch
from .. import store
from ..schemas import ChainRequest, OntologyRequest

router = APIRouter(prefix="/api", tags=["ontology"])


def _temperatures() -> Dict[str, float]:
    raw = store.get_settings().get("temperature", {}) or {}
    return {k: float(v) for k, v in raw.items()}


def _merge_policy(policy: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    settings = store.get_settings()
    merged: Dict[str, Any] = {
        "threshold": settings.get("threshold", 0.60),
        "auto_act": settings.get("auto_act", True),
        "noul_margin": settings.get("noul_margin", 0.15),
        "act_keys": [],
        "escalate_keys": [],
        "note": "",
    }
    if policy:
        merged.update({k: v for k, v in policy.items() if v is not None})
    return merged


def _state_text(state: Any, sources: Optional[List[Dict[str, Any]]]) -> str:
    bundle = onto.aggregate(state, sources)
    return "\n".join(d.text for d in bundle.docs)[:4000]


@router.post("/ontology/build")
def build(req: OntologyRequest) -> Dict[str, Any]:
    """汇聚数据并自动构建本体图（不消耗推理）。"""
    try:
        bundle = onto.aggregate(req.state, req.sources)
        graph = onto.build_ontology(bundle, top_concepts=req.top_concepts)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")
    return {
        "graph": graph.to_dict(),
        "stats": onto.graph_stats(graph),
        "bundle": bundle.to_dict(),
        "rendered": onto.render(graph),
    }


@router.post("/chain/plan")
def plan(req: ChainRequest) -> Dict[str, Any]:
    """只做依赖分析：拓扑分层 + 环检测，不跑推理。"""
    return orch.plan(req.questions or {})


@router.post("/decide/chain")
def decide_chain(req: ChainRequest) -> Dict[str, Any]:
    """蓝图级链式决策：汇聚 → 本体 → 动态子本体 → 链式多步 → 结论。"""
    questions = req.questions or {}
    if not questions:
        raise HTTPException(status_code=400, detail="questions 为空")
    try:
        plan_info = orch.plan(questions)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if plan_info.get("error"):
        raise HTTPException(status_code=400, detail=plan_info["error"])

    policy = _merge_policy(req.policy)
    try:
        result = orch.run_chain(
            engine_mod.engine,
            req.state,
            questions,
            sources=req.sources,
            temperature=_temperatures(),
            policy=policy,
            max_len=req.max_len,
            max_steps=req.max_steps,
            depth=req.depth,
            limit=req.limit,
            top_concepts=req.top_concepts,
            include_state_text=req.include_state_text,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")

    decision_id = None
    if req.record:
        decision_id = store.save_decision(
            {
                "mode": "chain",
                "batch_id": None,
                "blueprint_id": req.blueprint_id,
                "blueprint_name": req.blueprint_name,
                "domain": req.domain,
                "state_text": _state_text(req.state, req.sources),
                "state_json": req.state if isinstance(req.state, (dict, list)) else None,
                "questions": questions,
                "answers": result["answers"],
                "result": {
                    "usage": result.get("usage"),
                    "model": result.get("model"),
                    "rounds": result.get("rounds"),
                    "converged": result.get("converged"),
                    "steps": len(result.get("steps") or []),
                },
                "verdict": result.get("verdict"),
                "avg_confidence": result.get("avg_confidence"),
                "min_confidence": result.get("min_confidence"),
                "threshold": result.get("threshold"),
                "elapsed_ms": result.get("elapsed_ms"),
                "usage": result.get("usage"),
                "device": engine_mod.engine.device,
                "script": None,
                "language": None,
                "tags": req.tags or [],
            }
        )
    return {**result, "decision_id": decision_id, "policy": policy, "plan": plan_info}


@router.get("/chain/demo")
def chain_demo() -> Dict[str, Any]:
    """给前端预填的一条链式样例（带 depends_on 与 scope）。"""
    state: Dict[str, Any] = {
        "subject": "重复扣款，请马上退款",
        "body": "我在本月被重复扣款了两笔订阅费，共计398元。请今天退款，否则我们取消套餐并投诉。",
        "user": {"plan": "pro", "tenure_months": 26, "mrr": 199},
        "history": ["上月咨询过发票问题", "去年升级过套餐"],
    }
    questions: Dict[str, Dict[str, Any]] = {
        "是否要求退款": {
            "type": "noul",
            "instructions": "这条消息是否明确要求退款？",
        },
        "归属团队": {
            "type": "choice",
            "instructions": "这条消息应该归属哪个团队处理？",
            "criteria": {
                "财务": "发票、支付、扣款、退款、订阅费用",
                "技术": "崩溃、故障、报错、接口失败",
                "账号": "登录、权限、席位",
                "其他": "以上都不是",
            },
            "depends_on": ["是否要求退款"],
            "scope": {"keywords": ["扣款", "退款"], "depth": 2},
        },
        "紧急度": {
            "type": "score",
            "instructions": "这件事有多紧急？",
            "criteria": ["没有时间压力", "本周内需要处理", "正在阻塞对方"],
            "depends_on": ["归属团队"],
        },
    }
    return {"state": state, "questions": questions, "policy": {"threshold": 0.6}, "max_steps": 2}
