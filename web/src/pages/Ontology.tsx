import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type {
  Blueprint,
  ChainPlan,
  ChainResult,
  OntologyGraph,
  QuestionSpec,
} from "../lib/types";
import { pct } from "../lib/format";
import OntologyGraphView from "../components/OntologyGraphView";
import { ErrorBox, Panel, SectionTitle, Slider, Spinner } from "../components/ui";

const DEMO_STATE = {
  subject: "重复扣款，请马上退款",
  body: "我在本月被重复扣款了两笔订阅费，共计398元。请今天退款，否则我们取消套餐并投诉。",
  user: { plan: "pro", tenure_months: 26, mrr: 199 },
  history: ["上月咨询过发票问题", "去年升级过套餐"],
};

const DEMO_QUESTIONS: Record<string, QuestionSpec> = {
  是否要求退款: { type: "noul", instructions: "这条消息是否明确要求退款？" },
  归属团队: {
    type: "choice",
    instructions: "这条消息应该归属哪个团队处理？",
    criteria: {
      财务: "发票、支付、扣款、退款、订阅费用",
      技术: "崩溃、故障、报错、接口失败",
      账号: "登录、权限、席位",
      其他: "以上都不是",
    },
    depends_on: ["是否要求退款"],
    scope: { keywords: ["扣款", "退款"], depth: 2 },
  },
  紧急度: {
    type: "score",
    instructions: "这件事有多紧急？",
    criteria: ["没有时间压力", "本周内需要处理", "正在阻塞对方"],
    depends_on: ["归属团队"],
  },
};

function parseState(text: string): unknown {
  const t = text.trim();
  if (!t) return "";
  if (t.startsWith("{") || t.startsWith("[") || t.startsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      return text;
    }
  }
  return text;
}

const GATE_CLS: Record<string, string> = {
  act: "chip chip-act",
  escalate: "chip chip-escalate",
};

export default function Ontology() {
  const [stateText, setStateText] = useState(JSON.stringify(DEMO_STATE, null, 2));
  const [questions, setQuestions] = useState<Record<string, QuestionSpec>>(DEMO_QUESTIONS);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);

  const [graph, setGraph] = useState<OntologyGraph | null>(null);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [rendered, setRendered] = useState("");
  const [result, setResult] = useState<ChainResult | null>(null);
  const [plan, setPlan] = useState<ChainPlan | null>(null);

  const [threshold, setThreshold] = useState(0.6);
  const [maxSteps, setMaxSteps] = useState(2);
  const [depth, setDepth] = useState(1);
  const [limit, setLimit] = useState(16);
  const [topConcepts, setTopConcepts] = useState(40);

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selStep, setSelStep] = useState<number | null>(null);

  useEffect(() => {
    api
      .blueprints()
      .then((r) => setBlueprints(r.items))
      .catch(() => {});
    api
      .settings()
      .then((s) => setThreshold(s.threshold))
      .catch(() => {});
    api
      .chainDemo()
      .then((d) => {
        setStateText(JSON.stringify(d.state, null, 2));
        setQuestions(d.questions);
        setMaxSteps(d.max_steps || 2);
      })
      .catch(() => {});
  }, []);

  const keys = useMemo(() => Object.keys(questions), [questions]);

  const update = (key: string, patch: Partial<QuestionSpec>) =>
    setQuestions((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const toggleDep = (key: string, dep: string) => {
    const cur = questions[key]?.depends_on || [];
    const next = cur.includes(dep) ? cur.filter((d) => d !== dep) : [...cur, dep];
    update(key, { depends_on: next });
  };

  const setKeywords = (key: string, text: string) => {
    const list = text
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    update(key, { scope: { ...(questions[key]?.scope || {}), keywords: list } });
  };

  const buildGraph = async () => {
    setError(null);
    setLoading("graph");
    try {
      const r = await api.buildOntology({
        state: parseState(stateText),
        top_concepts: topConcepts,
      });
      setGraph(r.graph);
      setStats(r.stats.by_type);
      setRendered(r.rendered);
      setResult(null);
      setSelStep(null);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(null);
    }
  };

  const runChain = async () => {
    setError(null);
    setLoading("chain");
    try {
      const r = await api.decideChain({
        state: parseState(stateText),
        questions,
        policy: { threshold, auto_act: true },
        max_steps: maxSteps,
        depth,
        limit,
        top_concepts: topConcepts,
      });
      setResult(r);
      setPlan(r.plan || null);
      setGraph(r.graph);
      setSelStep(null);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(null);
    }
  };

  const checkPlan = async () => {
    setError(null);
    try {
      const p = await api.chainPlan(questions);
      setPlan(p);
      if (p.error) setError(p.error);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const shownGraph: OntologyGraph | null =
    selStep != null && result ? result.steps[selStep]?.subgraph || null : graph;

  const highlight =
    selStep != null && result ? result.steps[selStep]?.subgraph.nodes.map((n) => n.id) : undefined;

  return (
    <div className="space-y-5">
      <Panel className="p-6">
        <div className="section-title mb-2">本体与链路</div>
        <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-slate-50">
          先汇聚数据，自动摊成一张本体图；
          <br />
          每个决策因子再从图上裁一块自己的子本体，链式推进、多步收敛。
        </h2>
        <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-slate-400">
          一次蓝图执行分六步：<strong className="text-slate-200">汇聚数据 → 构建本体 → 因子分层 →
          动态子本体 → 链式推进 → 多步迭代</strong>。上游因子判出的结论会被写成图上的
          <strong className="text-slate-200">结论节点</strong>，下游因子裁子图时自然读到它——
          依赖不需要额外管道，它只是图上多出来的那一个节点。
        </p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-12">
        {/* 左：输入 */}
        <div className="space-y-4 xl:col-span-5">
          <Panel className="panel-pad">
            <SectionTitle
              right={
                <select
                  className="select w-[150px] py-1 text-[12px]"
                  defaultValue=""
                  onChange={(e) => {
                    const b = blueprints.find((x) => x.id === e.target.value);
                    if (!b) return;
                    setQuestions(b.questions);
                    if (b.policy?.threshold != null) setThreshold(b.policy.threshold);
                  }}
                >
                  <option value="">载入蓝图问题集…</option>
                  {blueprints.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              }
            >
              数据源（汇聚）
            </SectionTitle>
            <textarea
              className="textarea"
              value={stateText}
              onChange={(e) => setStateText(e.target.value)}
              spellCheck={false}
            />
            <div className="mt-2 text-[11.5px] leading-relaxed text-slate-600">
              支持纯文本或 JSON；结构化字段会变成属性节点，自然语言会抽成概念节点。
              真实场景里这里可以是工单正文 + 用户画像 + 历史记录多条来源。
            </div>
          </Panel>

          <Panel className="panel-pad">
            <SectionTitle
              right={<span className="text-[11.5px] text-slate-600">{keys.length} 个决策因子</span>}
            >
              决策因子（依赖与作用域）
            </SectionTitle>
            <div className="space-y-2.5">
              {keys.map((k) => {
                const q = questions[k];
                const kws = (q.scope?.keywords || []).join(", ");
                return (
                  <div key={k} className="rounded-xl border border-ink-600 bg-ink-800 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-slate-200">{k}</span>
                      <span className="chip">{q.type}</span>
                    </div>
                    <div className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">
                      {q.instructions}
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-600">依赖：</span>
                      {keys
                        .filter((o) => o !== k)
                        .map((o) => {
                          const on = (q.depends_on || []).includes(o);
                          return (
                            <button
                              key={o}
                              onClick={() => toggleDep(k, o)}
                              className={`rounded-md border px-1.5 py-0.5 text-[11px] transition ${
                                on
                                  ? "border-accent/40 bg-accent/12 text-accent-soft"
                                  : "border-ink-600 text-slate-500 hover:text-slate-300"
                              }`}
                            >
                              {o}
                            </button>
                          );
                        })}
                      {keys.length <= 1 && <span className="text-[11px] text-slate-600">（无其他因子）</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[11px] text-slate-600">关键词：</span>
                      <input
                        className="input flex-1 py-1 text-[12px]"
                        value={kws}
                        placeholder="扣款, 退款"
                        onChange={(e) => setKeywords(k, e.target.value)}
                      />
                      <span className="text-[11px] text-slate-600">跳数</span>
                      <input
                        className="input w-[52px] py-1 text-[12px]"
                        type="number"
                        min={1}
                        max={3}
                        value={q.scope?.depth ?? depth}
                        onChange={(e) =>
                          update(k, {
                            scope: { ...(q.scope || {}), depth: Number(e.target.value) || 1 },
                          })
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="btn btn-sm mt-3" onClick={checkPlan}>
              检查依赖（拓扑分层 / 环检测）
            </button>
            {plan && !plan.error && (
              <div className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
                分层：
                {plan.layers.map((l, i) => (
                  <span key={i} className="mr-1.5">
                    <span className="num text-accent-soft">L{i}</span> {l.join(" / ")}
                  </span>
                ))}
              </div>
            )}
          </Panel>

          <Panel className="panel-pad">
            <SectionTitle>链路参数</SectionTitle>
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between text-[12px]">
                <span className="text-slate-500">置信度阈值</span>
                <span className="num text-accent-soft">{pct(threshold, 0)}</span>
              </div>
              <Slider value={threshold} min={0.3} max={0.95} step={0.01} onChange={setThreshold} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-500">最多步数</span>
                <input
                  className="input w-[64px] py-1"
                  type="number"
                  min={1}
                  max={5}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(Number(e.target.value) || 1)}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-500">子图跳数</span>
                <input
                  className="input w-[64px] py-1"
                  type="number"
                  min={1}
                  max={3}
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value) || 1)}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-500">子图节点上限</span>
                <input
                  className="input w-[64px] py-1"
                  type="number"
                  min={6}
                  max={40}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value) || 16)}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-500">概念数上限</span>
                <input
                  className="input w-[64px] py-1"
                  type="number"
                  min={10}
                  max={80}
                  value={topConcepts}
                  onChange={(e) => setTopConcepts(Number(e.target.value) || 40)}
                />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button className="btn flex-1" onClick={buildGraph} disabled={loading !== null}>
                {loading === "graph" ? <Spinner label="构图中" /> : "构建本体"}
              </button>
              <button
                className="btn btn-primary flex-1"
                onClick={runChain}
                disabled={loading !== null || !keys.length}
              >
                {loading === "chain" ? <Spinner label="链式推进中" /> : "运行链式决策"}
              </button>
            </div>
            {error && <ErrorBox>{error}</ErrorBox>}
          </Panel>
        </div>

        {/* 右：结果 */}
        <div className="space-y-4 xl:col-span-7">
          <Panel className="panel-pad">
            <SectionTitle
              right={
                result ? (
                  <span className="flex items-center gap-2 text-[11.5px] text-slate-500">
                    <span className="chip">{result.rounds} 轮</span>
                    <span className={result.converged ? "chip chip-act" : "chip"}>
                      {result.converged ? "已收敛" : "未收敛"}
                    </span>
                    <span className="num">{result.elapsed_ms} ms</span>
                  </span>
                ) : stats ? (
                  <span className="text-[11.5px] text-slate-600">
                    属性 {stats.attribute ?? 0} · 概念 {stats.concept ?? 0} · 结论 {stats.conclusion ?? 0}
                  </span>
                ) : null
              }
            >
              本体图
            </SectionTitle>
            {selStep != null && result && (
              <div className="mb-2 flex items-center justify-between rounded-lg border border-accent/25 bg-accent/[0.07] px-3 py-2 text-[11.5px] text-slate-300">
                <span>
                  正在看第 {selStep + 1} 步「{result.steps[selStep]?.key}」的动态子本体
                </span>
                <button className="btn btn-sm" onClick={() => setSelStep(null)}>
                  返回全图
                </button>
              </div>
            )}
            <OntologyGraphView graph={shownGraph} highlight={highlight} />
          </Panel>

          {result && (
            <>
              <Panel className="panel-pad">
                <SectionTitle>链式轨迹</SectionTitle>
                <div className="space-y-1.5">
                  {result.steps.map((s, i) => (
                    <button
                      key={s.seq}
                      onClick={() => setSelStep(selStep === i ? null : i)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                        selStep === i
                          ? "border-accent/40 bg-accent/[0.08]"
                          : "border-ink-600 hover:border-ink-500"
                      }`}
                    >
                      <span className="num w-8 text-[12px] text-slate-600">#{s.seq}</span>
                      <span className="chip">R{s.round}</span>
                      <span className="w-[110px] shrink-0 truncate text-[12.5px] text-slate-200">
                        {s.key}
                      </span>
                      <span className="flex-1 truncate text-[12px] text-slate-400">
                        {s.answer.display}
                      </span>
                      <span className="num text-[12px] text-accent-soft">
                        {pct(s.answer.confidence, 0)}
                      </span>
                      <span className={GATE_CLS[s.answer.gate?.decision || "act"]}>
                        {s.answer.gate?.decision === "escalate" ? "升级" : "执行"}
                      </span>
                      {s.changed && <span className="chip chip-accent">已变化</span>}
                      <span className="w-[74px] text-right text-[11px] text-slate-600">
                        {s.subgraph.nodes.length} 节点
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-3 text-[11.5px] leading-relaxed text-slate-600">
                  点任一步可看它当时读到的子本体。「已变化」表示这一轮的答案与上一轮不同——
                  多步迭代的价值就体现在这里：上游结论进图之后，下游的后验会收紧。
                </div>
                {selStep != null && result.steps[selStep]?.state_text && (
                  <pre className="mt-3 max-h-[260px] overflow-auto rounded-xl border border-ink-600 bg-ink-900 p-3 text-[11px] leading-relaxed text-slate-400">
                    {result.steps[selStep].state_text}
                  </pre>
                )}
              </Panel>

              <Panel className="panel-pad">
                <SectionTitle
                  right={
                    <span className="flex items-center gap-2 text-[11.5px] text-slate-500">
                      <span className="chip">{result.verdict === "act" ? "自动执行" : result.verdict === "review" ? "部分复核" : "升级人工"}</span>
                      <span className="num">均置信 {pct(result.avg_confidence ?? 0, 0)}</span>
                    </span>
                  }
                >
                  最终结论
                </SectionTitle>
                <div className="space-y-2">
                  {Object.entries(result.answers).map(([k, a]) => (
                    <div
                      key={k}
                      className="flex items-center gap-3 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2"
                    >
                      <span className="w-[110px] shrink-0 truncate text-[12.5px] text-slate-300">{k}</span>
                      <span className="flex-1 text-[13px] text-slate-100">{a.display}</span>
                      <span className="num text-[12px] text-accent-soft">
                        {pct(a.answer_confidence, 0)}
                      </span>
                      <span className={GATE_CLS[a.gate?.decision || "act"]}>
                        {a.gate?.decision === "escalate" ? "升级" : "执行"}
                      </span>
                    </div>
                  ))}
                </div>
                {result.unsettled.length > 0 && (
                  <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11.5px] text-amber-700/90">
                    仍未过阈：{result.unsettled.join("、")}——这些因子的不确定性需要交给人工，
                    多跑几轮也一样。
                  </div>
                )}
              </Panel>
            </>
          )}

          {!result && rendered && (
            <Panel className="panel-pad">
              <SectionTitle>本体渲染（模型实际读到的文本）</SectionTitle>
              <pre className="max-h-[320px] overflow-auto rounded-xl border border-ink-600 bg-ink-900 p-3 text-[11.5px] leading-relaxed text-slate-400">
                {rendered}
              </pre>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
