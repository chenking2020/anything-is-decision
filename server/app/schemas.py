"""API 数据模型。"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field

State = Union[str, Dict[str, Any], List[Any]]

QuestionType = Literal["choice", "score", "noul"]


class Question(BaseModel):
    """一个类型化问题（决策原子）。"""

    type: QuestionType
    instructions: str
    criteria: Union[Dict[str, str], List[str], None] = None
    labels: Optional[Dict[str, str]] = None


class DecidingPolicy(BaseModel):
    threshold: float = 0.60
    act_keys: List[str] = Field(default_factory=list)
    escalate_keys: List[str] = Field(default_factory=list)
    note: str = ""
    auto_act: bool = True
    noul_margin: float = 0.15
    # 级联：按问题顺序逐个决策，并把已得出的结论写回状态给下一个原子
    cascade: bool = False


class DecideRequest(BaseModel):
    state: State
    questions: Dict[str, Dict[str, Any]]
    policy: Optional[DecidingPolicy] = None
    max_len: Optional[int] = None
    blueprint_id: Optional[str] = None
    blueprint_name: Optional[str] = None
    domain: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    record: bool = True


class BatchItem(BaseModel):
    state: State
    ref: Optional[str] = None


class BatchRequest(BaseModel):
    items: List[BatchItem]
    questions: Dict[str, Dict[str, Any]]
    policy: Optional[DecidingPolicy] = None
    blueprint_id: Optional[str] = None
    blueprint_name: Optional[str] = None
    domain: Optional[str] = None
    batch_size: int = 16
    max_len: Optional[int] = None
    record: bool = True


class OntologyRequest(BaseModel):
    """只看本体：汇聚数据 + 构图，不跑推理。"""

    state: Optional[Any] = None
    sources: Optional[List[Dict[str, Any]]] = None
    top_concepts: int = 40


class ChainRequest(BaseModel):
    """链式决策：汇聚 → 本体 → 动态子本体 → 链式多步 → 结论。

    ``questions`` 里每个因子可以额外声明：
      * ``depends_on: [上游因子名]`` —— 链式依赖，上游结论会被写成图上的节点；
      * ``scope: {"types": [...], "keywords": [...], "depth": 2}`` —— 只关心图上这一块。
    """

    state: Optional[Any] = None
    sources: Optional[List[Dict[str, Any]]] = None
    questions: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    policy: Optional[Dict[str, Any]] = None
    max_len: Optional[int] = None
    max_steps: int = 1
    depth: int = 1
    limit: int = 16
    top_concepts: int = 40
    include_state_text: bool = True
    blueprint_id: Optional[str] = None
    blueprint_name: Optional[str] = None
    domain: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    record: bool = True


class BlueprintIn(BaseModel):
    name: str
    domain: str = "通用"
    description: str = ""
    questions: Dict[str, Dict[str, Any]]
    state_hint: Dict[str, Any] = Field(default_factory=dict)
    sample_states: List[Dict[str, Any]] = Field(default_factory=list)
    policy: Dict[str, Any] = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)


class FeedbackIn(BaseModel):
    question_key: str
    truth: str


class SettingsModel(BaseModel):
    threshold: float = 0.60
    temperature: Dict[str, float] = Field(
        default_factory=lambda: {"choice": 1.0, "score": 1.0, "noul": 1.0}
    )
    auto_act: bool = True
    noul_margin: float = 0.15
