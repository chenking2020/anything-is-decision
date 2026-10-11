"""全局配置。

所有路径都以仓库根目录为锚点，权重默认指向仓库内已下载好的
``weights/laya-multilingual``（本地加载，不访问 Hugging Face）。
"""

from __future__ import annotations

import os
from pathlib import Path

# server/app/config.py -> 仓库根目录
ROOT: Path = Path(__file__).resolve().parents[2]

WEIGHTS_DIR: Path = Path(
    os.environ.get("LAYA_WEIGHTS_DIR", str(ROOT / "weights" / "laya-multilingual"))
)
ENCODER_DIR: Path = WEIGHTS_DIR / "encoder"
TOKENIZER_DIR: Path = WEIGHTS_DIR / "tokenizer"
RL_CONFIG_PATH: Path = WEIGHTS_DIR / "rl_agent_config.json"

DATA_DIR: Path = Path(os.environ.get("AID_DATA_DIR", str(ROOT / "server" / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH: Path = DATA_DIR / "anything-is-decision.db"

DEVICE: str = os.environ.get("LAYA_DEVICE", "auto")
MAX_LEN: int = int(os.environ.get("LAYA_MAX_LEN", "1024"))
DEFAULT_THRESHOLD: float = float(os.environ.get("AID_THRESHOLD", "0.60"))
BATCH_SIZE: int = int(os.environ.get("AID_BATCH_SIZE", "16"))

CHECKPOINT_NAME = "laya-multilingual"
CHECKPOINT_REPO = "convaiinnovations/laya-multilingual"

PLATFORM_NAME = "Anything is Decision"
PLATFORM_TAGLINE = "多语言通用决策平台"
