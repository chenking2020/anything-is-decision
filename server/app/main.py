"""Anything is Decision · 多语言通用决策平台 —— FastAPI 应用入口。"""

from __future__ import annotations

import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict

os.environ.setdefault("USE_TF", "0")

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from . import store  # noqa: E402
from .config import PLATFORM_NAME, PLATFORM_TAGLINE, ROOT  # noqa: E402
from .routers import blueprints, calibration, chain, decisions, ledger, meta  # noqa: F401,E402

WEB_DIST = ROOT / "web" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.init_db()
    if os.environ.get("AID_PRELOAD", "1") == "1":
        from . import engine as engine_mod

        def _warm() -> None:
            try:
                engine_mod.engine.load()
            except Exception:
                pass  # 状态会体现在 /api/meta 上

        threading.Thread(target=_warm, daemon=True).start()
    yield


app = FastAPI(
    title=f"{PLATFORM_NAME} · {PLATFORM_TAGLINE}",
    description=(
        "以 Laya 非自回归多语言决策引擎为核心的通用决策平台："
        "把任何判断原子化成类型化问题（choice / score / noul），一次前向得到带概率的答案，"
        "再用置信门控决定自动执行还是升级人工。"
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (meta.router, decisions.router, chain.router, blueprints.router, ledger.router, calibration.router):
    app.include_router(r)


@app.get("/api", include_in_schema=False)
def api_index() -> Dict[str, Any]:
    return {"name": PLATFORM_NAME, "tagline": PLATFORM_TAGLINE, "docs": "/docs"}


if WEB_DIST.exists():
    assets = WEB_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/", include_in_schema=False)
    def index() -> Any:
        return FileResponse(WEB_DIST / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> Any:
        target = WEB_DIST / full_path
        if full_path and target.exists() and target.is_file():
            return FileResponse(target)
        return FileResponse(WEB_DIST / "index.html")
else:

    @app.get("/", include_in_schema=False)
    def no_frontend() -> Any:
        return JSONResponse(
            {
                "name": PLATFORM_NAME,
                "tagline": PLATFORM_TAGLINE,
                "hint": "前端尚未构建：cd web && npm install && npm run build，然后重启后端；开发模式可直接 npm run dev（已配置 /api 代理）。",
            }
        )
