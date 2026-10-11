import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useMeta } from "../lib/MetaContext";
import type {
  Blueprint,
  ChainPlan,
  ChainResult,
  DecideResult,
  OntologyGraph,
  QuestionSpec,
} from "../lib/types";
import { parseState, pct, stateToText } from "../lib/format";
import { AnswerCard, VerdictBanner } from "../components/AnswerCard";
import { QuestionEditor } from "../components/QuestionEditor";
import OntologyGraphView from "../components/OntologyGraphView";
import {
  Empty,
  ErrorBox,
  Panel,
  SectionTitle,
  Segmented,
  Slider,
  Spinner,
  Toggle,
} from "../components/ui";

/** 决策维度（问题、选项、等级）一律用中文表达；多语言只作用于被决策的原始数据。 */
const DEFAULT_QUESTIONS: Record<string, QuestionSpec> = {
  是否要求退款: {
    type: "noul",
    instructions: "这条消息是否明确要求退款？",
  },
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
    criteria: ["没有时间压力，纯咨询", "本周内需要处理", "正在阻塞对方的工作"],
    depends_on: ["归属团队"],
  },
};

const DEFAULT_STATE = {
  subject: "重复扣款，请马上退款",
  body: "我在本月被重复扣款了两笔订阅费，共计398元。请今天退款，否则我们取消套餐并投诉。",
  user: { plan: "pro", tenure_months: 26, mrr: 199 },
  history: ["上月咨询过发票问题", "去年升级过套餐"],
};

const GATE_CLS: Record<string, string> = {
  act: "chip chip-act",
  escalate: "chip chip-escalate",
};

type Tab = "conclusion" | "graph" | "trace" | "raw";

export default function Workbench() {
  const { bpId } = useParams();
  const navigate = useNavigate();
  const { meta } = useMeta();

  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [bp, setBp] = useState<Blueprint | null>(null);
  const [questions, setQuestions] = useState<Record<string, QuestionSpec>>(DEFAULT_QUESTIONS);
  const [stateText, setStateText] = useState(JSON.stringify(DEFAULT_STATE, null, 2));
  const [sources, setSources] = useState<{ id: string; text: string }[]>([]);

  const [mode, setMode] = useState<"chain" | "flat">("chain");
  const [threshold, setThreshold] = useState(0.6);
  const [autoAct, setAutoAct] = useState(true);
  const [cascade, setCascade] = useState(false);
  const [maxLen, setMaxLen] = useState(1024);
  const [maxSteps, setMaxSteps] = useState(2);
  const [depth, setDepth] = useState(1);
  const [limit, setLimit] = useState(16);
  const [topConcepts, setTopConcepts] = useState(40);

  const [chainResult, setChainResult] = useState<ChainResult | null>(null);
  const [flatResult, setFlatResult] = useState<DecideResult | null>(null);
  const [graph, setGraph] = useState<OntologyGraph | null>(null);
  const [graphStats, setGraphStats] = useState<Record<string, number> | null>(null);
  const [rendered, setRendered] = useState("");
  const [plan, setPlan] = useState<ChainPlan | null>(null);
  const [selStep, setSelStep] = useState<number | null>(null);

  const [loading, setLoading] = useState<"graph" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routing, setRouting] = useState<any>(null);
  const [truths, setTruths] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("conclusion");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const timer = useRef<any>(null);
  const anchors = useRef<Record<string, HTMLDivElement | null>>({});

  // 载入蓝图列表与全局设置
  useEffect(() => {
    api
      .blueprints()
      .then((r) => setBlueprints(r.items))
      .catch(() => {});
    api
      .settings()
      .then((s) => {
        setThreshold(s.threshold);
        setAutoAct(s.auto_act);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!bpId) return;
    api
      .blueprint(bpId)
      .then((b) => applyBlueprint(b))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpId]);

  const applyBlueprint = (b: Blueprint) => {
    setBp(b);
    setQuestions(b.questions);
    if (b.state_hint && Object.keys(b.state_hint).length) {
      setStateText(
        typeof b.state_hint === "object"
          ? JSON.stringify(b.state_hint, null, 2)
          : String(b.state_hint)
      );
    }
    if (b.policy?.threshold != null) setThreshold(b.policy.threshold);
    if (b.policy?.auto_act != null) setAutoAct(b.policy.auto_act);
    if (b.policy?.cascade != null) setCascade(b.policy.cascade);
    setChainResult(null);
    setFlatResult(null);
    setGraph(null);
    setGraphStats(null);
    setSelStep(null);
    setTruths({});
  };

  // 状态变化时做脚本/语言分析（不走前向）
  const analyse = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api
        .route(parseState(text))
        .then(setRouting)
        .catch(() => setRouting(null));
    }, 350);
  }, []);

  useEffect(() => {
    analyse(stateText);
  }, [stateText, analyse]);

  const activeSources = sources
    .filter((s) => s.text.trim())
    .map((s, i) => ({ id: s.id || `src${i + 1}`, text: s.text }));

  const buildGraph = async () => {
    setError(null);
    setLoading("graph");
    try {
      const r = await api.buildOntology({
        state: parseState(stateText),
        sources: activeSources.length ? activeSources : undefined,
        top_concepts: topConcepts,
      });
      setGraph(r.graph);
      setGraphStats(r.stats.by_type);
      setRendered(r.rendered);
      setChainResult(null);
      setFlatResult(null);
      setSelStep(null);
      setTab("graph");
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setLoading(null);
    }
  };

  const run = async () => {
    setLoading("run");
    setError(null);
    setSavedMsg(null);
    setSelStep(null);
    try {
      if (mode === "chain") {
        const r = await api.decideChain({
          state: parseState(stateText),
          sources: activeSources.length ? activeSources : undefined,
          questions,
          policy: { threshold, auto_act: autoAct, noul_margin: 0.15 },
          max_len: maxLen,
          max_steps: maxSteps,
          depth,
          limit,
          top_concepts: topConcepts,
          include_state_text: true,
          blueprint_id: bp?.id,
          blueprint_name: bp?.name,
          domain: bp?.domain,
          record: true,
        });
        setChainResult(r);
        setFlatResult(null);
        setGraph(r.graph);
        setPlan(r.plan || null);
        setGraphStats(null);
        setTruths({});
      } else {
        const r = await api.decide({
          state: parseState(stateText),
          questions,
          policy: { threshold, auto_act: autoAct, noul_margin: 0.15, cascade },
          max_len: maxLen,
          blueprint_id: bp?.id,
          blueprint_name: bp?.name,
          domain: bp?.domain,
          tags: bp?.tags ?? [],
          record: true,
        });
        setFlatResult(r);
        setChainResult(null);
        setTruths({});
      }
      setTab("conclusion");
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setLoading(null);
    }
  };

  // ⌘/Ctrl + Enter 直接跑
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!loading) run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, questions, stateText, sources, threshold, mode]);

  const checkPlan = async () => {
    setError(null);
    try {
      const p = await api.chainPlan(questions);
      setPlan(p);
      if (p.error) setError(p.error);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  const resultId = chainResult?.decision_id ?? flatResult?.decision_id ?? null;

  const onTruth = async (key: string, truth: string) => {
    if (!resultId) return;
    if (!truth) {
      setTruths((t) => ({ ...t, [key]: "" }));
      return;
    }
    try {
      const r = await api.feedback(resultId, key, truth);
      setTruths(r.feedback);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  const saveAsBlueprint = async () => {
    const name = window.prompt("蓝图名称", bp ? `${bp.name}（副本）` : "我的决策蓝图");
    if (!name) return;
    try {
      const created = await api.createBlueprint({
        name,
        domain: bp?.domain ?? "自定义",
        description: bp?.description ?? "在工作台中创建的决策蓝图",
        questions,
        state_hint: (typeof parseState(stateText) === "object"
          ? parseState(stateText)
          : { body: stateText }) as any,
        policy: { threshold, auto_act: autoAct, cascade },
        tags: bp?.tags ?? [],
      });
      setSavedMsg(`已保存为蓝图「${created.name}」`);
      navigate("/blueprints");
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  const questionCount = Object.keys(questions).length;
  const ready = meta?.status === "ready";
  const result = chainResult ?? flatResult;

  // 工作流进度：① 汇聚 ② 本体 ③ 因子 ④ 门控 ⑤ 结论
  const stepState: Record<string, "done" | "todo"> = {
    data: stateText.trim() || activeSources.length ? "done" : "todo",
    ontology: graph ? "done" : "todo",
    factors: questionCount ? "done" : "todo",
    gate: result ? "done" : "todo",
  };
  const steps: { id: string; n: string; label: string; hint: string }[] = [
    { id: "data", n: "①", label: "汇聚数据", hint: "主状态 + 附加来源" },
    { id: "ontology", n: "②", label: "构建本体", hint: "自动摊成一张图" },
    { id: "factors", n: "③", label: "决策因子", hint: "类型 + 依赖 + 作用域" },
    { id: "gate", n: "④", label: "门控与运行", hint: "阈值 · 步数 · 收敛" },
  ];
  const goto = (id: string) =>
    anchors.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });

  const shownGraph: OntologyGraph | null =
    selStep != null && chainResult ? chainResult.steps[selStep]?.subgraph || graph : graph;
  const highlight =
    selStep != null && chainResult
      ? chainResult.steps[selStep]?.subgraph.nodes.map((n) => n.id)
      : undefined;

  const tabs: { id: Tab; label: string }[] =
    mode === "chain"
      ? [
          { id: "conclusion", label: "结论" },
          { id: "graph", label: "本体图" },
          { id: "trace", label: "链路轨迹" },
          { id: "raw", label: "原始响应" },
        ]
      : [
          { id: "conclusion", label: "结论" },
          { id: "raw", label: "原始响应" },
        ];

  return (
    <div className="space-y-4">
      {/* 工作流进度条 */}
      <Panel className="panel-pad">
        <div className="flex flex-wrap items-center gap-2">
          {steps.map((s, i) => (
            <React.Fragment key={s.id}>
              <button
                onClick={() => goto(s.id)}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition ${
                  stepState[s.id] === "done"
                    ? "border-accent/30 bg-accent/[0.07]"
                    : "border-ink-600 hover:border-ink-500"
                }`}
              >
                <span
                  className={`num text-[13px] ${
                    stepState[s.id] === "done" ? "text-accent-soft" : "text-slate-600"
                  }`}
                >
                  {s.n}
                </span>
                <span>
                  <span className="block text-[12.5px] text-slate-200">{s.label}</span>
                  <span className="block text-[10.5px] text-slate-600">{s.hint}</span>
                </span>
              </button>
              {i < steps.length - 1 && <span className="text-[11px] text-slate-700">→</span>}
            </React.Fragment>
          ))}
          <span className="ml-auto text-[11.5px] text-slate-600">
            一次运行走完全流程：汇聚 → 本体 → 因子分层 → 动态子本体 → 链式推进 → 多步收敛
          </span>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-12">
        {/* 左：工作流输入 */}
        <div className="space-y-4 xl:col-span-5">
          {/* ① 汇聚数据 */}
          <div
            ref={(el) => {
              anchors.current.data = el;
            }}
          >
            <Panel className="panel-pad">
              <SectionTitle
                right={
                  <select
                    className="select w-[210px] py-1 text-[12px]"
                    value={bp?.id ?? ""}
                    onChange={(e) => {
                      const b = blueprints.find((x) => x.id === e.target.value);
                      if (b) applyBlueprint(b);
                      else {
                        setBp(null);
                        setQuestions(DEFAULT_QUESTIONS);
                      }
                    }}
                  >
                    <option value="">— 使用内置示例问题 —</option>
                    {blueprints.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.domain} · {b.name}
                      </option>
                    ))}
                  </select>
                }
              >
                ① 汇聚数据
              </SectionTitle>

              {bp ? (
                <div className="mb-3">
                  <div className="text-[13.5px] font-medium text-slate-50">{bp.name}</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{bp.description}</p>
                  {bp.policy?.note && (
                    <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11.5px] text-amber-700/90">
                      {bp.policy.note}
                    </div>
                  )}
                  {bp.sample_states?.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11.5px] text-slate-600">样例：</span>
                      {bp.sample_states.map((s, i) => (
                        <button
                          key={i}
                          className="btn btn-sm"
                          onClick={() =>
                            setStateText(
                              typeof s.state === "object"
                                ? JSON.stringify(s.state, null, 2)
                                : String(s.state)
                            )
                          }
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mb-3 text-[12px] leading-relaxed text-slate-500">
                  选一张蓝图即载入该领域的成熟因子集；也可以直接用下面这套示例，点右下角运行。
                </p>
              )}

              <div className="section-title mb-1.5">主状态（State）</div>
              <textarea
                className="textarea"
                value={stateText}
                onChange={(e) => setStateText(e.target.value)}
                spellCheck={false}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[11.5px] text-slate-600">
                  {routing?.script && <span className="chip chip-accent">{routing.script}</span>}
                  {stateToText(parseState(stateText)).length} 字 · 支持纯文本或 JSON
                </span>
                <select
                  className="select w-[120px] py-1 text-[12px]"
                  value={maxLen}
                  onChange={(e) => setMaxLen(Number(e.target.value))}
                >
                  {[1024, 2048, 4096, 8192].map((n) => (
                    <option key={n} value={n}>
                      {n} tokens
                    </option>
                  ))}
                </select>
              </div>
              {routing?.advice && (
                <div className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
                  {routing.advice}
                </div>
              )}

              <div className="mt-3 border-t border-ink-600 pt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="section-title">附加来源（可选）</span>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      setSources((s) => [...s, { id: `src${s.length + 1}`, text: "" }])
                    }
                  >
                    + 添加来源
                  </button>
                </div>
                {sources.length === 0 ? (
                  <div className="text-[11.5px] leading-relaxed text-slate-600">
                    真实场景里可以是工单正文 + 用户画像 + 历史记录多条来源；每条来源都会成为图上的一个数据源节点。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sources.map((s, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          className="input w-[92px] shrink-0 py-1 font-mono text-[12px]"
                          value={s.id}
                          onChange={(e) =>
                            setSources((arr) =>
                              arr.map((x, j) => (j === i ? { ...x, id: e.target.value } : x))
                            )
                          }
                        />
                        <textarea
                          className="textarea min-h-[58px] flex-1 py-1.5 text-[12px]"
                          placeholder="例如：用户画像 JSON，或另一段原始记录"
                          value={s.text}
                          onChange={(e) =>
                            setSources((arr) =>
                              arr.map((x, j) => (j === i ? { ...x, text: e.target.value } : x))
                            )
                          }
                        />
                        <button
                          className="btn btn-sm btn-danger h-fit"
                          onClick={() => setSources((arr) => arr.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          </div>

          {/* ② 构建本体 */}
          <div
            ref={(el) => {
              anchors.current.ontology = el;
            }}
          >
            <Panel className="panel-pad">
              <SectionTitle
                right={
                  <span className="flex items-center gap-2 text-[11.5px] text-slate-600">
                    {graph ? (
                      <>
                        <span>
                          属性 {graphStats?.attribute ?? 0} · 概念 {graphStats?.concept ?? 0} · 结论{" "}
                          {graphStats?.conclusion ?? 0}
                        </span>
                      </>
                    ) : (
                      <span>运行后自动生成</span>
                    )}
                  </span>
                }
              >
                ② 构建本体
              </SectionTitle>
              <p className="mb-3 text-[11.5px] leading-relaxed text-slate-500">
                结构化字段变成属性节点，自然语言抽成概念节点，多来源之间按共现连边——
                这一步不消耗推理，可以单独预览。
              </p>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
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
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn flex-1" onClick={buildGraph} disabled={loading !== null}>
                  {loading === "graph" ? <Spinner label="构图中" /> : "只构建本体（预览）"}
                </button>
              </div>
              {rendered && !chainResult && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[11.5px] text-slate-500">
                    查看本体渲染（模型实际读到的文本）
                  </summary>
                  <pre className="scroll-thin mt-2 max-h-[240px] overflow-auto rounded-lg border border-ink-600 bg-ink-900 p-3 text-[11px] leading-relaxed text-slate-400">
                    {rendered}
                  </pre>
                </details>
              )}
            </Panel>
          </div>

          {/* ③ 决策因子 */}
          <div
            ref={(el) => {
              anchors.current.factors = el;
            }}
          >
            <Panel className="panel-pad">
              <SectionTitle
                right={<span className="text-[11.5px] text-slate-600">{questionCount} 个决策因子</span>}
              >
                ③ 决策因子（依赖与作用域）
              </SectionTitle>
              <QuestionEditor questions={questions} onChange={setQuestions} chainMode />
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
              <div className="mt-2 text-[11.5px] leading-relaxed text-slate-600">
                勾选依赖后，上游因子的结论会被写成图上的
                <strong className="text-slate-400">结论节点</strong>
                ，下游因子裁子图时自然读到它——依赖不需要额外管道。
              </div>
            </Panel>
          </div>

          {/* ④ 门控与运行 */}
          <div
            ref={(el) => {
              anchors.current.gate = el;
            }}
          >
            <Panel className="panel-pad">
              <SectionTitle>④ 门控策略与运行</SectionTitle>

              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-[12px] text-slate-500">运行模式</span>
                <Segmented<"chain" | "flat">
                  value={mode}
                  options={[
                    { value: "chain", label: "完整链路" },
                    { value: "flat", label: "快速扁平" },
                  ]}
                  onChange={setMode}
                />
              </div>

              <div className="mb-4">
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-slate-500">置信度阈值</span>
                  <span className="num text-accent-soft">{pct(threshold, 0)}</span>
                </div>
                <Slider value={threshold} min={0.3} max={0.95} step={0.01} onChange={setThreshold} />
                <div className="mt-1.5 text-[11.5px] text-slate-600">
                  阈值是一个<strong className="text-slate-400">策略</strong>：它决定你愿意接受多少错误、
                  换取多少自动化覆盖率，请在标定页用真实数据选。
                </div>
              </div>

              <div className="space-y-2">
                <Toggle checked={autoAct} onChange={setAutoAct} label="允许自动执行（关闭则全部升级人工）" />
                {mode === "flat" && (
                  <Toggle
                    checked={cascade}
                    onChange={setCascade}
                    label="级联推理：把每个原子的结论写回状态后，再判下一个原子"
                  />
                )}
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  className="btn btn-primary flex-1"
                  onClick={run}
                  disabled={loading !== null || !questionCount}
                >
                  {loading === "run" ? (
                    <Spinner label={mode === "chain" ? "链式推进中" : "一次前向传播中"} />
                  ) : mode === "chain" ? (
                    "运行完整工作流（⌘/Ctrl + Enter）"
                  ) : (
                    "快速决策（⌘/Ctrl + Enter）"
                  )}
                </button>
                <button className="btn" onClick={saveAsBlueprint}>
                  存为蓝图
                </button>
              </div>
              {!ready && (
                <div className="mt-2 text-[11.5px] text-amber-700/90">
                  引擎还在加载权重，首次点击会自动等待加载完成。
                </div>
              )}
              {savedMsg && <div className="mt-2 text-[11.5px] text-emerald-700">{savedMsg}</div>}
            </Panel>
          </div>
        </div>

        {/* 右：结果 */}
        <div className="space-y-4 xl:col-span-7">
          <ErrorBox>{error}</ErrorBox>

          {!result ? (
            <Panel className="panel-pad">
              <Empty
                action={
                  <button className="btn btn-primary btn-sm" onClick={run} disabled={loading !== null}>
                    运行完整工作流
                  </button>
                }
              >
                还没有结论。左侧填好数据、因子与阈值，一次运行走完
                <strong className="text-slate-300"> 汇聚 → 本体 → 因子分层 → 动态子本体 → 链式推进 → 多步收敛 </strong>
                。
              </Empty>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  { t: "choice · 单选", d: "在自定义标签集上 softmax，返回每个选项的概率" },
                  { t: "score · 等级", d: "有序量规上的期望等级 + 分布，适合紧急度、严重度" },
                  { t: "noul · 是非", d: "只问一个命题，返回校准后的 P(true)，适合风控与护栏" },
                ].map((x) => (
                  <div key={x.t} className="rounded-xl border border-ink-600 bg-ink-800 p-3">
                    <div className="num text-[12px] text-accent-soft">{x.t}</div>
                    <div className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{x.d}</div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`rounded-lg border px-3 py-1.5 text-[12px] transition ${
                      tab === t.id
                        ? "border-accent/40 bg-accent/[0.1] text-slate-100"
                        : "border-ink-600 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
                {chainResult && (
                  <span className="ml-auto flex items-center gap-2 text-[11.5px] text-slate-500">
                    <span className="chip">{chainResult.rounds} 轮</span>
                    <span className={chainResult.converged ? "chip chip-act" : "chip"}>
                      {chainResult.converged ? "已收敛" : "未收敛"}
                    </span>
                    <span className="num">{chainResult.elapsed_ms.toFixed(0)} ms</span>
                  </span>
                )}
              </div>

              {tab === "conclusion" && (
                <ConclusionTab
                  chain={chainResult}
                  flat={flatResult}
                  threshold={threshold}
                  truths={truths}
                  onTruth={onTruth}
                  hasId={!!resultId}
                />
              )}

              {tab === "graph" && (
                <Panel className="panel-pad">
                  <SectionTitle
                    right={
                      <span className="text-[11.5px] text-slate-600">
                        {shownGraph?.nodes.length ?? 0} 节点
                      </span>
                    }
                  >
                    本体图
                  </SectionTitle>
                  {selStep != null && chainResult && (
                    <div className="mb-2 flex items-center justify-between rounded-lg border border-accent/25 bg-accent/[0.07] px-3 py-2 text-[11.5px] text-slate-300">
                      <span>
                        正在看第 {selStep + 1} 步「{chainResult.steps[selStep]?.key}」的动态子本体
                      </span>
                      <button className="btn btn-sm" onClick={() => setSelStep(null)}>
                        返回全图
                      </button>
                    </div>
                  )}
                  <OntologyGraphView graph={shownGraph} highlight={highlight} />
                </Panel>
              )}

              {tab === "trace" && chainResult && (
                <Panel className="panel-pad">
                  <SectionTitle right={<span className="text-[11.5px] text-slate-600">{chainResult.steps.length} 步</span>}>
                    链式轨迹
                  </SectionTitle>
                  <div className="space-y-1.5">
                    {chainResult.steps.map((s, i) => (
                      <button
                        key={s.seq}
                        onClick={() => {
                          setSelStep(selStep === i ? null : i);
                          if (selStep !== i) setTab("graph");
                        }}
                        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                          selStep === i
                            ? "border-accent/40 bg-accent/[0.08]"
                            : "border-ink-600 hover:border-ink-500"
                        }`}
                      >
                        <span className="num w-8 text-[12px] text-slate-600">#{s.seq}</span>
                        <span className="chip">R{s.round}</span>
                        <span className="w-[100px] shrink-0 truncate text-[12.5px] text-slate-200">
                          {s.key}
                        </span>
                        <span className="flex-1 truncate text-[12px] text-slate-400">
                          {s.answer.type === "noul"
                            ? `${s.answer.boolean ? "是" : "否"} · P=${(Number(s.answer.value) * 100).toFixed(1)}%`
                            : s.answer.display}
                        </span>
                        <span className="num text-[12px] text-accent-soft">
                          {pct(s.answer.confidence, 0)}
                        </span>
                        <span className={GATE_CLS[s.answer.gate?.decision || "act"]}>
                          {s.answer.gate?.decision === "escalate" ? "升级" : "执行"}
                        </span>
                        {s.changed && <span className="chip chip-accent">已变化</span>}
                        <span className="w-[64px] text-right text-[11px] text-slate-600">
                          {s.subgraph.nodes.length} 节点
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 text-[11.5px] leading-relaxed text-slate-600">
                    点任一步看它当时读到的子本体。「已变化」表示这一轮与上一轮答案不同——
                    多步迭代的价值就在这里：上游结论进图之后，下游的后验会收紧。
                  </div>
                  {selStep != null && chainResult.steps[selStep]?.state_text && (
                    <pre className="scroll-thin mt-3 max-h-[260px] overflow-auto rounded-xl border border-ink-600 bg-ink-900 p-3 text-[11px] leading-relaxed text-slate-400">
                      {chainResult.steps[selStep].state_text}
                    </pre>
                  )}
                </Panel>
              )}

              {tab === "raw" && (
                <Panel className="panel-pad">
                  <SectionTitle>原始响应</SectionTitle>
                  <pre className="scroll-thin max-h-[420px] overflow-auto rounded-xl border border-ink-600 bg-ink-900 p-3 text-[11.5px] leading-relaxed text-slate-400">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConclusionTab({
  chain,
  flat,
  threshold,
  truths,
  onTruth,
  hasId,
}: {
  chain: ChainResult | null;
  flat: DecideResult | null;
  threshold: number;
  truths: Record<string, string>;
  onTruth: (key: string, truth: string) => void;
  hasId: boolean;
}) {
  const verdict = chain?.verdict ?? flat?.verdict ?? "review";
  const avg = chain?.avg_confidence ?? flat?.avg_confidence ?? null;
  const min = chain?.min_confidence ?? flat?.min_confidence ?? null;
  const elapsed = chain?.elapsed_ms ?? flat?.elapsed_ms ?? undefined;
  const answers = (chain?.answers ?? flat?.answers ?? {}) as Record<string, any>;

  return (
    <>
      <VerdictBanner
        verdict={verdict}
        avg={avg}
        min={min}
        elapsed={elapsed}
        threshold={chain?.threshold ?? flat?.threshold ?? threshold}
        routing={flat?.routing}
      />

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {Object.values(answers).map((a: any) => (
          <AnswerCard
            key={a.key}
            answer={a}
            truth={truths[a.key]}
            onTruth={hasId ? (t) => onTruth(a.key, t) : undefined}
          />
        ))}
      </div>

      {chain && chain.unsettled.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11.5px] text-amber-700/90">
          仍未过阈：{chain.unsettled.join("、")}——这些因子的不确定性要交给人工，多跑几轮也一样。
        </div>
      )}

      <Panel className="panel-pad mt-4">
        <SectionTitle>本次调用的元信息</SectionTitle>
        <div className="grid gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-2">
          <MetaRow k="模型" v={chain?.model ?? flat?.model ?? "—"} />
          <MetaRow k="耗时" v={`${(chain?.elapsed_ms ?? flat?.elapsed_ms ?? 0).toFixed(1)} ms`} />
          {chain ? (
            <>
              <MetaRow k="轮数 / 步数" v={`${chain.rounds} 轮 · ${chain.steps.length} 步`} />
              <MetaRow k="本体规模" v={`${chain.graph.nodes.length} 节点 · ${chain.graph.edges.length} 边`} />
              <MetaRow
                k="分层"
                v={chain.layers.map((l) => l.join("/")).join("  →  ") || "无依赖（单层）"}
              />
              <MetaRow k="链式" v={chain.chained ? "是（有依赖因子）" : "否（因子彼此独立）"} />
            </>
          ) : (
            <>
              <MetaRow k="输入 tokens" v={String(flat?.usage?.input_tokens ?? 0)} />
              <MetaRow k="输出 tokens" v={String(flat?.usage?.output_tokens ?? 0)} />
            </>
          )}
          <MetaRow k="因子数" v={String(Object.keys(answers).length)} />
          <MetaRow k="账本 ID" v={chain?.decision_id ?? flat?.decision_id ?? "—"} />
        </div>
        {!hasId && (
          <div className="mt-2 text-[11.5px] text-slate-600">
            本次未入账（record=false），人工标注真值不可用。
          </div>
        )}
      </Panel>
    </>
  );
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-600 pb-1">
      <span className="text-slate-500">{k}</span>
      <span className="num truncate text-slate-300">{v}</span>
    </div>
  );
}
