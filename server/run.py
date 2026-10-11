"""启动脚本：python server/run.py [--port 8000] [--device mps] [--no-preload]"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(description="Anything is Decision 决策平台后端")
    parser.add_argument("--host", default=os.environ.get("AID_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("AID_PORT", "8000")))
    parser.add_argument("--device", default=os.environ.get("LAYA_DEVICE", "auto"))
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--no-preload", action="store_true")
    args = parser.parse_args()

    os.environ["LAYA_DEVICE"] = args.device
    os.environ["AID_PRELOAD"] = "0" if args.no_preload else "1"

    import uvicorn

    uvicorn.run(
        "app.main:app",
        app_dir=str(ROOT / "server"),
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
