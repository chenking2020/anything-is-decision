import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useMeta } from "../lib/MetaContext";
import { compact } from "../lib/format";

const NAV = [
  { to: "/", label: "总览", hint: "平台脉搏", icon: "M3 12h4l3 8 4-16 3 8h4" },
  { to: "/workbench", label: "决策工作台", hint: "单条决策", icon: "M4 6h16M4 12h10M4 18h14" },
  { to: "/ontology", label: "本体与链路", hint: "汇聚·本体·链式", icon: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" },
  { to: "/blueprints", label: "蓝图库", hint: "决策模板", icon: "M4 6h16M4 12h16M4 18h10" },
  { to: "/batch", label: "批量决策", hint: "吞吐与导出", icon: "M3 5h18v6H3zM3 13h18v6H3z" },
  { to: "/ledger", label: "决策账本", hint: "审计与反馈", icon: "M6 3h9l5 5v13H6zM14 3v6h6" },
  { to: "/calibration", label: "标定与门控", hint: "阈值与温度", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { to: "/methodology", label: "方法论", hint: "为什么这样做", icon: "M12 3v18M5 8h14M7 16h10" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { meta, error } = useMeta();
  const loc = useLocation();

  const status = meta?.status ?? (error ? "error" : "loading");
  const statusCls =
    status === "ready"
      ? "chip chip-act"
      : status === "loading"
      ? "chip"
      : "chip chip-escalate animate-pulse-soft";

  return (
    <div className="relative z-10 flex min-h-screen">
      {/* 侧边栏 */}
      <aside className="sticky top-0 hidden h-screen w-[228px] shrink-0 flex-col border-r border-ink-600 bg-ink-800 px-4 py-5 md:flex">
        <div className="mb-7 flex items-center gap-2.5 px-1">
          <div className="grid h-8 w-8 place-items-center rounded-lg border border-accent/30 bg-accent/10">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <div>
            <div className="text-[14px] font-semibold tracking-tight text-slate-50">Anything is Decision</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">多语言决策平台</div>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map((n) => {
            const active = loc.pathname === n.to;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                className={`group flex items-center gap-3 rounded-lg px-2.5 py-2 transition ${
                  active ? "bg-accent/12 text-slate-50" : "text-slate-400 hover:bg-white hover:text-slate-200"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 ${active ? "text-accent" : "text-slate-600 group-hover:text-slate-400"}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <path d={n.icon} />
                </svg>
                <span className="flex-1 text-[13px]">{n.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3 pt-6">
          <div className="rounded-xl border border-ink-600 bg-white p-3">
            <div className="section-title mb-2">引擎</div>
            <div className="flex items-center justify-between text-[11.5px] text-slate-400">
              <span>检查点</span>
              <span className="num text-slate-300">{meta?.checkpoint ?? "—"}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11.5px] text-slate-400">
              <span>设备</span>
              <span className="num text-slate-300">{meta?.device ?? "—"}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11.5px] text-slate-400">
              <span>参数量</span>
              <span className="num text-slate-300">{compact(meta?.parameters)}</span>
            </div>
          </div>
          <div className="px-1 text-[10.5px] leading-relaxed text-slate-600">
            权重本地加载 · Apache 2.0
            <br />
            mmBERT 编码 + RLCD 决策头
          </div>
        </div>
      </aside>

      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-ink-600 bg-ink-950/80 px-5 py-3 backdrop-blur">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[15px] font-semibold tracking-tight text-slate-50">
              {NAV.find((n) => n.to === loc.pathname)?.label ?? "Anything is Decision"}
            </h1>
            <span className="hidden text-[12px] text-slate-500 sm:inline">
              {NAV.find((n) => n.to === loc.pathname)?.hint}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className={statusCls}>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "ready" ? "bg-emerald-400" : status === "loading" ? "bg-slate-400" : "bg-amber-400"
                }`}
              />
              {status === "ready" ? "引擎就绪" : status === "loading" ? "加载权重中" : "引擎异常"}
            </span>
            {meta?.avg_elapsed_ms != null && (
              <span className="chip">
                均值 <span className="num ml-1 text-slate-300">{meta.avg_elapsed_ms.toFixed(0)}ms</span>
              </span>
            )}
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm hidden sm:inline-flex"
            >
              API 文档
            </a>
          </div>
        </header>

        <main className="scroll-thin min-w-0 flex-1 overflow-x-hidden px-5 py-6">{children}</main>

        <footer className="border-t border-ink-600 px-5 py-3 text-[11px] text-slate-600">
          Anything is Decision · 概率是决策的输入，不是结论。所有自动执行都必须由阈值与人工复核共同承担。
        </footer>
      </div>
    </div>
  );
}
