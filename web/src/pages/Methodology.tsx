import React from "react";
import { Link } from "react-router-dom";
import { useMeta } from "../lib/MetaContext";
import { compact, num } from "../lib/format";
import { Panel, SectionTitle } from "../components/ui";

const STEPS = [
  {
    n: "01",
    t: "汇聚数据",
    d: "多条来源——正文、画像、历史记录、交易流水——统一成文档集 + 属性表。不需要先入湖、先对齐主键。",
  },
  {
    n: "02",
    t: "构建本体",
    d: "结构化字段变成属性节点，自然语言抽成概念节点，同句共现连成边。纯 Python 启发式，不调用 LLM。",
  },
  {
    n: "03",
    t: "因子分层",
    d: "决策因子声明 depends_on，按依赖做拓扑分层；同层互不依赖，可以共享一次前向传播。",
  },
  {
    n: "04",
    t: "动态子本体",
    d: "每个因子按自己的 scope（类型 / 关键词 / 跳数）从全图裁一块 k 跳邻域——同一份数据，不同因子读不同的图。",
  },
  {
    n: "05",
    t: "链式推进",
    d: "上游结论被写成图上的结论节点，下游裁子图时自然读到它。依赖不是参数传递，而是图上多出来的那个节点。",
  },
  {
    n: "06",
    t: "多步迭代",
    d: "重复以上几步若干轮，直到取值稳定或达到 max_steps。每一步都留下轨迹：读了哪块子图、置信多少、怎么裁决。",
  },
];

const COMPARE: { dim: string; palantir: string; aid: string }[] = [
  {
    dim: "核心抽象",
    palantir: "本体（Ontology）：先把组织的数据、对象、关系建模成一个世界模型",
    aid: "决策因子（Decision Factor）：把一次判断拆成带类型的问题集，每个因子从本体图上裁一块自己的子图",
  },
  {
    dim: "前置成本",
    palantir: "需要先完成数据接入、实体对齐、本体建模，决策能力在底座建成之后才出现",
    aid: "零前置：给一批数据 + 一组因子，第一次调用就能产出决策；本体是执行时现构的，用完即弃",
  },
  {
    dim: "答案形态",
    palantir: "查询结果、图谱路径、以及越来越多的生成式文本结论",
    aid: "类型化取值 + 完整概率分布 + 集中度 + 门控裁决，结构化、可比较、可阈值化",
  },
  {
    dim: "时延",
    palantir: "面向分析与工作流，秒级到分钟级；LLM 环节更慢",
    aid: "单因子一次前向约 30 ms，批量约 7 ms/问；链路开销 = 轮数 × 层数 × 一次前向，按需打开",
  },
  {
    dim: "不确定性",
    palantir: "主要由人来把握，系统给出的是结果与解释",
    aid: "不确定性是一等公民：概率被标定、被绘制成曲线、被阈值化成策略",
  },
  {
    dim: "失败模式",
    palantir: "本体建错、数据滞后 → 结论系统性偏移，且往往无声",
    aid: "分布过于平坦 → 置信度低 → 自动升级人工，失败被显式暴露",
  },
  {
    dim: "语言",
    palantir: "以英文生态为主",
    aid: "100+ 语言同一套问题、同一个检查点，多语言才是主战场",
  },
  {
    dim: "成本结构",
    palantir: "平台 + 实施 + 持续的数据工程",
    aid: "3 亿参数的开源权重，单机自托管，边际成本趋近于零",
  },
];

const NOT_FOR = [
  "需要生成一段文本、一封回信、一份报告——这是自回归模型的活，本平台刻意不做。",
  "需要多步规划、工具调用、长链推理——本平台只负责「这一步怎么判断」。",
  "需要外部事实检索与引用——模型不联网、不检索，它只读你给的状态。",
  "需要给每一次判断写出可长篇追溯的推理过程——它给的是概率与分布，不是论证。",
  "高风险且不可撤销的决定（医疗诊断、司法裁决）——本平台只做分诊与排序辅助，且默认强制人工。",
];

export default function Methodology() {
  const { meta } = useMeta();
  const cfg = meta?.config ?? {};

  return (
    <div className="space-y-5">
      <Panel className="p-6">
        <div className="section-title mb-2">方法论</div>
        <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-slate-50">
          先汇聚数据、自动摊成一张本体图；
          <br />
          每个决策因子再裁一块自己的子本体，链式推进、多步收敛。
        </h2>
        <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-slate-400">
          Palantir 的路径是<strong className="text-slate-200">先建本体</strong>：把组织的数据整合成一个世界模型，
          再在这个模型上做分析与行动——本体是长期资产，也是长期负债。
          Anything is Decision 走的是<strong className="text-slate-200">本体 + 决策</strong>：
          本体不预先建模，而是在每次执行时从汇聚来的原始材料里<strong className="text-slate-200">现构</strong>一张图，
          每个决策因子按自己的 scope 裁一块动态子图来读，判完的结论又写回图上给下游因子用。
          它回答的是「此刻该做什么，以及我有多确定」。
        </p>
      </Panel>

      {/* 六步 */}
      <div className="grid gap-3 md:grid-cols-3">
        {STEPS.map((s) => (
          <Panel key={s.n} className="panel-pad">
            <div className="num text-[13px] text-accent-soft">{s.n}</div>
            <div className="mt-1.5 text-[13.5px] font-medium text-slate-50">{s.t}</div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">{s.d}</p>
          </Panel>
        ))}
      </div>

      {/* 对照表 */}
      <Panel className="panel-pad">
        <SectionTitle>与 Palantir 的方法论对照</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="w-[110px] py-2 font-medium">维度</th>
                <th className="py-2 font-medium">Palantir（本体驱动）</th>
                <th className="py-2 font-medium">Anything is Decision（本体 + 决策）</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-600">
              {COMPARE.map((c) => (
                <tr key={c.dim} className="align-top">
                  <td className="py-3 pr-3 text-[12.5px] font-medium text-slate-300">{c.dim}</td>
                  <td className="py-3 pr-4 leading-relaxed text-slate-500">{c.palantir}</td>
                  <td className="py-3 leading-relaxed text-slate-300">{c.aid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-[11.5px] leading-relaxed text-slate-600">
          二者并不互斥：本体擅长回答「是什么」，决策引擎擅长回答「此刻怎么做」。
          真正的生产系统里，Anything is Decision 通常站在最前面——用几十毫秒决定这条输入该走哪条路、要不要交给更贵更慢的系统。
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 原语 */}
        <Panel className="panel-pad">
          <SectionTitle>三个决策原语</SectionTitle>
          <div className="space-y-3">
            {[
              {
                t: "choice · 单选",
                c: "text-cyan-700",
                d: "在请求里给出的标签集上做 softmax。每个标签都带一句判据描述，选项数控制在 20 以内。",
                u: "路由、意图识别、分类归属",
              },
              {
                t: "score · 等级",
                c: "text-violet-700",
                d: "有序量规上的期望等级 + 分布。每一级都要写清楚判据，等级不超过 5。",
                u: "紧急度、严重度、情绪强度",
              },
              {
                t: "noul · 是非",
                c: "text-emerald-700",
                d: "只问一个命题，返回校准后的 P(是)。概率接近 0.5 时会被门控拦下。",
                u: "风控、护栏、流失信号、合规升级",
              },
            ].map((x) => (
              <div key={x.t} className="rounded-xl border border-ink-600 bg-ink-800 p-3.5">
                <div className={`num text-[13px] ${x.c}`}>{x.t}</div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-slate-400">{x.d}</p>
                <div className="mt-1.5 text-[11.5px] text-slate-600">典型用途：{x.u}</div>
              </div>
            ))}
          </div>
        </Panel>

        {/* 为什么概率可信 */}
        <Panel className="panel-pad">
          <SectionTitle>为什么这里的概率是可信的</SectionTitle>
          <div className="space-y-3 text-[12.5px] leading-relaxed text-slate-400">
            <p>
              模型用 RLCD 训练：奖励来自<strong className="text-slate-200">严格适当评分规则</strong>。
              「严格适当」意味着模型只有在如实报告自己的信念时，期望奖励才最大——撒谎（把概率推向 0 或 1）
              在期望上必然吃亏。这与自回归模型「下一个 token 的似然」是完全不同的目标函数：
              后者优化的是文本连贯性，前者优化的是信念的诚实度。
            </p>
            <p>
              它还是<strong className="text-slate-200">非自回归</strong>的：没有采样、没有解码、没有
              「再生成一遍看看」，因此同一份输入永远得到同一份输出——这对审计至关重要。
            </p>
            <p>
              但这不等于「出厂即可信」。适当评分规则保证的是<strong className="text-slate-200">可标定</strong>，
              不是<strong className="text-slate-200">已标定</strong>。本检查点出厂 temperature 全为 1.0，
              系统性过度自信——所以本平台才把「拟合温度」做成一等公民功能。
            </p>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-[11.5px] text-amber-700/90">
              置信度只给决策<strong>排序</strong>，不证明决策<strong>正确</strong>。
              任何阈值都是你在自己数据上选定的策略，不是模型的属性。
            </div>
          </div>
        </Panel>
      </div>

      {/* 门控经济学 */}
      <Panel className="panel-pad">
        <SectionTitle>门控经济学</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-ink-600 bg-ink-800 p-4">
            <div className="text-[13px] font-medium text-slate-50">阈值 = 一次权衡</div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
              阈值每提高一点，自动化覆盖率下降、覆盖率内的准确率上升。
              两条曲线画出来，你才知道自己买的是哪一种错误。
            </p>
          </div>
          <div className="rounded-xl border border-ink-600 bg-ink-800 p-4">
            <div className="text-[13px] font-medium text-slate-50">升级不是失败</div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
              「升级人工」是系统的正常输出之一：它把不确定性显式地交还给人，
              而不是用一段流畅的文本把它盖住。
            </p>
          </div>
          <div className="rounded-xl border border-ink-600 bg-ink-800 p-4">
            <div className="text-[13px] font-medium text-slate-50">按问题分别门控</div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
              一个状态上的多个问题可以有不同命运：归属自动路由，紧急度和流失风险进人工队列。
              蓝图里的 act_keys / escalate_keys 就是为此存在。
            </p>
          </div>
        </div>
        <div className="mt-4">
          <Link to="/calibration" className="btn btn-primary btn-sm">
            去标定页画出我的曲线
          </Link>
        </div>
      </Panel>

      {/* 不该用它做什么 */}
      <Panel className="panel-pad">
        <SectionTitle>什么时候不该用它</SectionTitle>
        <ul className="space-y-2">
          {NOT_FOR.map((x) => (
            <li key={x} className="flex gap-2.5 text-[12.5px] leading-relaxed text-slate-400">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-600" />
              {x}
            </li>
          ))}
        </ul>
      </Panel>

      {/* 模型卡 */}
      <Panel className="panel-pad">
        <SectionTitle>模型卡（来自本地权重）</SectionTitle>
        <div className="grid gap-x-8 gap-y-1.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["检查点", meta?.checkpoint ?? "laya-multilingual"],
            ["编码器", meta?.encoder ?? "mmBERT-base"],
            ["参数量", compact(meta?.parameters)],
            ["隐藏维度 / 层数", "768 / 22"],
            ["上下文", `${meta?.max_len ?? 1024}（RoPE 支持 ${meta?.context_limit ?? 8192}）`],
            ["头部预算", `${meta?.head_max_len ?? 256} tokens`],
            ["决策头", `${cfg.head_layers ?? 2} 层 Transformer + 选项标记打分 + act/escalate 头`],
            ["训练", `RLCD ${cfg.training?.updates ?? 15987} 步 / ${cfg.training?.epochs_completed ?? 4} epoch / ${cfg.training?.hours ?? 4.97} h`],
            ["出厂温度", `[${(meta?.temperature_raw ?? [1, 1, 1]).join(", ")}]`],
            ["MASSIVE 意图（51 语言）", "macro 0.366 · 45/51 语言超过 3× 随机"],
            ["XNLI（15 语言）", "英文 0.843 · 其他 14 语言 0.731"],
            ["速度", "1 问 32.8 ms · 批量 6.8 ms/问（T4）"],
            ["许可", "Apache 2.0 · Convai Innovations"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 border-b border-ink-600 pb-1.5">
              <span className="text-slate-500">{k}</span>
              <span className="num truncate text-slate-200">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[11.5px] text-slate-600">
          以上指标摘自官方模型卡（第三方复现环境不同会有差异）；本平台只保证「如实呈现概率与门控」，
          不保证任何领域的开箱准确率——那是标定页要用你自己的数据回答的问题。
        </div>
      </Panel>
    </div>
  );
}
