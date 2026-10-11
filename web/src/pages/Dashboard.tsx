import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useMeta } from "../lib/MetaContext";
import type { LedgerRow, LedgerStats } from "../lib/types";
import { compact, ms, pct, shortTime, verdictChip, verdictLabel } from "../lib/format";
import { Empty, ErrorBox, Histogram, Panel, SectionTitle, Spinner, Stat } from "../components/ui";

export default function Dashboard() {
  const { meta, error: metaError } = useMeta();
  const [stats, setStats] = useState<LedgerStats | null>(null);
  const [recent, setRecent] = useState<LedgerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.ledgerStats(), api.ledger({ limit: 7 })])
      .then(([s, r]) => {
        setStats(s);
        setRecent(r.items);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, []);

  const total = stats?.total ?? 0;
  const act = stats?.by_verdict?.act ?? 0;
  const actRate = total ? act / total : null;

  return (
    <div className="space-y-6">
      {/* 引言 */}
      <Panel className="overflow-hidden p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <div className="section-title mb-2">多语言通用决策平台</div>
            <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-slate-50">
              任何东西，都可以是一次决策。
            </h2>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-slate-400">
              Anything is Decision 不生成文本、不做检索。它汇聚你的数据、自动摊成一张
              <strong className="text-slate-200">本体图</strong>，让每个<strong className="text-slate-200">决策因子</strong>
              裁一块自己的子本体，在单次前向里给出带概率的答案，再由置信门控决定
              「自动执行」还是「升级人工」。100+ 语言、约 30 ms、可审计、可标定。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/workbench" className="btn btn-primary">
              打开决策工作台
            </Link>
            <Link to="/blueprints" className="btn">
              浏览蓝图库
            </Link>
            <Link to="/batch" className="btn">
              批量决策
            </Link>
          </div>
        </div>
      </Panel>

      <ErrorBox>{metaError || error}</ErrorBox>

      {/* 指标 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="决策总数" value={total} hint="账本中留痕的决策次数" />
        <Stat
          label="自动执行率"
          value={pct(actRate, 0)}
          tone={actRate && actRate > 0.7 ? "good" : "warn"}
          hint="达到阈值、无需人工的比例"
        />
        <Stat
          label="平均置信度"
          value={pct(stats?.avg_confidence)}
          tone="accent"
          hint="出厂未标定，偏自信；请在标定页拟合温度"
        />
        <Stat label="平均延迟" value={ms(stats?.avg_elapsed_ms)} hint="含批量分摊，本机实测" />
        <Stat
          label="人工反馈样本"
          value={stats?.feedback_count ?? 0}
          tone={(stats?.feedback_count ?? 0) > 0 ? "good" : "warn"}
          hint="标定量：样本越多，温度越可信"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 引擎 */}
        <Panel className="panel-pad lg:col-span-1">
          <SectionTitle>引擎状态</SectionTitle>
          {!meta ? (
            <Spinner label="读取引擎信息" />
          ) : (
            <dl className="space-y-2 text-[12.5px]">
              {[
                ["检查点", meta.checkpoint],
                ["编码器", meta.encoder ?? "—"],
                ["设备 / 精度", `${meta.device ?? "—"} · ${meta.dtype ?? "—"}`],
                ["参数量", compact(meta.parameters)],
                ["上下文", `${meta.max_len}（可扩展 ${meta.context_limit}）`],
                ["头部预算", `${meta.head_max_len} tokens`],
                ["出厂温度", `[${(meta.temperature_raw || []).join(", ")}]`],
                ["加载耗时", meta.load_seconds != null ? `${meta.load_seconds}s` : "—"],
                ["累计调用", `${meta.calls} 次 / ${meta.questions_answered} 问`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-ink-600 pb-1.5">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="num truncate text-slate-200">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {meta?.status !== "ready" && (
            <div className="mt-3 text-[11.5px] text-amber-700/90">
              引擎尚未就绪：首次加载需要把 322M 权重读进内存（本机约 8–10 秒）。
            </div>
          )}
        </Panel>

        {/* 置信分布 */}
        <Panel className="panel-pad lg:col-span-1">
          <SectionTitle>置信度分布</SectionTitle>
          {total ? (
            <>
              <Histogram
                values={stats?.confidence_histogram ?? []}
                labels={["0", "", "", "", "", "", "", "", "", "1"]}
              />
              <div className="mt-2 flex justify-between text-[10.5px] text-slate-600">
                <span>低置信（升级人工）</span>
                <span>高置信（自动执行）</span>
              </div>
            </>
          ) : (
            <Empty>还没有决策记录，去工作台跑第一条。</Empty>
          )}
        </Panel>

        {/* 裁决分布 */}
        <Panel className="panel-pad lg:col-span-1">
          <SectionTitle>门控裁决</SectionTitle>
          <div className="space-y-3">
            {["act", "review", "escalate"].map((v) => {
              const n = stats?.by_verdict?.[v] ?? 0;
              const ratio = total ? n / total : 0;
              return (
                <div key={v}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className={v === "act" ? "text-emerald-700" : v === "review" ? "text-sky-700" : "text-amber-700"}>
                      {verdictLabel[v]}
                    </span>
                    <span className="num text-slate-500">
                      {n} · {pct(ratio, 0)}
                    </span>
                  </div>
                  <div className="prob-track">
                    <div
                      className={`prob-fill ${
                        v === "act" ? "bg-emerald-500/80" : v === "review" ? "bg-sky-500/80" : "bg-amber-500/80"
                      }`}
                      style={{ width: `${Math.max(1.5, ratio * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4">
            <SectionTitle>近 14 天</SectionTitle>
            <Histogram
              values={(stats?.by_day ?? []).map((d) => d.count)}
              height={64}
              color="#4f46e5"
            />
          </div>
        </Panel>
      </div>

      {/* 最近决策 */}
      <Panel className="panel-pad">
        <SectionTitle
          right={
            <Link to="/ledger" className="link text-[12px]">
              查看全部 →
            </Link>
          }
        >
          最近的决策
        </SectionTitle>
        {loading ? (
          <Spinner label="加载账本" />
        ) : recent.length === 0 ? (
          <Empty
            action={
              <Link to="/workbench" className="btn btn-primary btn-sm">
                开始第一次决策
              </Link>
            }
          >
            账本为空。每一条决策都会被完整记录：状态、问题、概率分布、路由、耗时。
          </Empty>
        ) : (
          <div className="divide-y divide-ink-600">
            {recent.map((r) => (
              <Link
                key={r.id}
                to="/ledger"
                className="flex flex-wrap items-center gap-3 py-2.5 transition hover:bg-ink-800"
              >
                <span className="num text-[11.5px] text-slate-600">{shortTime(r.created_at)}</span>
                <span className="w-[150px] truncate text-[13px] text-slate-200">
                  {r.blueprint_name || "自定义决策"}
                </span>
                <span className="max-w-[380px] flex-1 truncate text-[12px] text-slate-500">
                  {r.state_text?.slice(0, 120)}
                </span>
                <span className={`chip ${r.verdict ? "" : ""}`}>{r.domain || "—"}</span>
                <span className={verdictChip[r.verdict ?? "review"]}>{verdictLabel[r.verdict ?? "review"]}</span>
                <span className="num text-[12px] text-slate-500">{pct(r.avg_confidence)}</span>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
