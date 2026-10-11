import React from "react";
import type { QuestionSpec, QuestionType } from "../lib/types";
import { Panel, Segmented } from "./ui";

export const emptyQuestion = (type: QuestionType): QuestionSpec =>
  type === "choice"
    ? { type: "choice", instructions: "", criteria: { A: "", B: "" } }
    : type === "score"
    ? { type: "score", instructions: "", criteria: ["", ""] }
    : { type: "noul", instructions: "" };

export function QuestionEditor({
  questions,
  onChange,
  readOnly = false,
  chainMode = false,
}: {
  questions: Record<string, QuestionSpec>;
  onChange: (q: Record<string, QuestionSpec>) => void;
  readOnly?: boolean;
  /** 开启后每个因子可以声明上游依赖与子本体作用域 */
  chainMode?: boolean;
}) {
  const keys = Object.keys(questions);

  const patch = (key: string, next: Partial<QuestionSpec>) =>
    onChange({ ...questions, [key]: { ...questions[key], ...next } as QuestionSpec });

  const renameKey = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey) return;
    const next: Record<string, QuestionSpec> = {};
    for (const k of keys) {
      const q = questions[k];
      if (k === oldKey) {
        next[newKey] = q;
        continue;
      }
      // 重命名时同步改写别人对它的依赖，避免链路断掉
      const deps = q.depends_on?.map((d) => (d === oldKey ? newKey : d));
      next[k] = deps ? { ...q, depends_on: deps } : q;
    }
    onChange(next);
  };

  const remove = (key: string) => {
    const next = { ...questions };
    delete next[key];
    onChange(next);
  };

  const addQuestion = () => {
    let i = 1;
    let key = `q${i}`;
    while (questions[key]) key = `q${++i}`;
    onChange({ ...questions, [key]: emptyQuestion("choice") });
  };

  return (
    <div className="space-y-3">
      {keys.map((key) => {
        const q = questions[key];
        const criteria = q.criteria;
        const warnings: string[] = [];
        if (q.type === "choice") {
          const c = (criteria as Record<string, string>) || {};
          if (Object.keys(c).length > 20) warnings.push("选项超过 20 个，token 预算被摊薄，准确率会骤降");
          for (const k of Object.keys(c)) {
            if (["true", "false", "yes", "no"].includes(String(k).toLowerCase()))
              warnings.push(`选项 “${k}” 是真值词，模型会跟着标签走而不是内容`);
          }
          if (Object.keys(c).length >= 2 && Object.values(c).some((v) => !v.trim()))
            warnings.push("有选项缺少描述，模型只能用标签猜");
        }
        if (q.type === "score") {
          const c = (criteria as string[]) || [];
          if (c.length > 5) warnings.push("等级超过 5 级：score 是最弱的原语，等级越多越不可靠");
          if (c.some((v) => !v.trim())) warnings.push("有等级缺少描述");
        }

        return (
          <Panel key={key} className="p-3.5">
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <input
                className="input w-[130px] font-mono"
                value={key}
                disabled={readOnly}
                onChange={(e) => renameKey(key, e.target.value.replace(/[^\w\u4e00-\u9fa5-]/g, "_"))}
              />
              <Segmented<QuestionType>
                value={q.type}
                options={[
                  { value: "choice", label: "单选" },
                  { value: "score", label: "等级" },
                  { value: "noul", label: "是非" },
                ]}
                onChange={(t) => {
                  const keep = t === q.type;
                  patch(key, keep ? {} : (emptyQuestion(t) as Partial<QuestionSpec>));
                }}
              />
              <div className="ml-auto flex items-center gap-2">
                {!readOnly && (
                  <button className="btn btn-sm btn-danger" onClick={() => remove(key)}>
                    删除
                  </button>
                )}
              </div>
            </div>

            <input
              className="input mb-2.5"
              placeholder={q.type === "noul" ? "问句：发件人是否要求退款？" : "问句：这条消息该归给哪个团队？"}
              value={q.instructions}
              disabled={readOnly}
              onChange={(e) => patch(key, { instructions: e.target.value })}
            />

            {q.type === "choice" && (
              <ChoiceCriteria
                criteria={(criteria as Record<string, string>) || {}}
                readOnly={readOnly}
                onChange={(c) => patch(key, { criteria: c })}
              />
            )}
            {q.type === "score" && (
              <ScoreCriteria
                criteria={(criteria as string[]) || []}
                readOnly={readOnly}
                onChange={(c) => patch(key, { criteria: c })}
              />
            )}
            {q.type === "noul" && (
              <div className="text-[11.5px] leading-relaxed text-slate-500">
                返回 <span className="num text-emerald-700">P(是)</span> ∈ [0,1]；
                概率接近 0.5 时会被门控拦下升级人工。
              </div>
            )}

            {chainMode && !readOnly && (
              <ChainSettings
                spec={q}
                others={keys.filter((k) => k !== key)}
                defaultDepth={1}
                onChange={(p) => patch(key, p)}
              />
            )}

            {warnings.length > 0 && (
              <ul className="mt-2.5 space-y-1">
                {warnings.map((w, i) => (
                  <li key={i} className="text-[11.5px] text-amber-700/90">
                    ⚠ {w}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      })}

      {!readOnly && (
        <button className="btn w-full border-dashed" onClick={addQuestion}>
          + 增加一个决策问题
        </button>
      )}
    </div>
  );
}

/** 链路设置：上游依赖（结论会写成图节点） + 子本体作用域（关键词 / 跳数） */
function ChainSettings({
  spec,
  others,
  defaultDepth,
  onChange,
}: {
  spec: QuestionSpec;
  others: string[];
  defaultDepth: number;
  onChange: (p: Partial<QuestionSpec>) => void;
}) {
  const deps = spec.depends_on || [];
  const kws = (spec.scope?.keywords || []).join(", ");
  const toggleDep = (dep: string) =>
    onChange({
      depends_on: deps.includes(dep) ? deps.filter((d) => d !== dep) : [...deps, dep],
    });

  return (
    <div className="mt-2.5 rounded-lg border border-ink-600 bg-ink-800 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="section-title">链路设置</span>
        <span className="text-[10.5px] text-slate-600">依赖上游结论 · 只裁自己关心的子图</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[11px] text-slate-600">依赖：</span>
        {others.length === 0 && <span className="text-[11px] text-slate-600">（没有其他因子）</span>}
        {others.map((o) => {
          const on = deps.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => toggleDep(o)}
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
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-slate-600">关键词：</span>
        <input
          className="input flex-1 py-1 text-[12px]"
          value={kws}
          placeholder="扣款, 退款（留空则按依赖取邻域）"
          onChange={(e) =>
            onChange({
              scope: {
                ...(spec.scope || {}),
                keywords: e.target.value
                  .split(/[,，\s]+/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            })
          }
        />
        <span className="text-[11px] text-slate-600">跳数</span>
        <input
          className="input w-[52px] py-1 text-[12px]"
          type="number"
          min={1}
          max={3}
          value={spec.scope?.depth ?? defaultDepth}
          onChange={(e) =>
            onChange({ scope: { ...(spec.scope || {}), depth: Number(e.target.value) || 1 } })
          }
        />
      </div>
    </div>
  );
}

function ChoiceCriteria({
  criteria,
  onChange,
  readOnly,
}: {
  criteria: Record<string, string>;
  onChange: (c: Record<string, string>) => void;
  readOnly?: boolean;
}) {
  const entries = Object.entries(criteria);
  const setLabel = (oldLabel: string, newLabel: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of entries) next[k === oldLabel ? newLabel : k] = v;
    onChange(next);
  };
  const setValue = (label: string, value: string) => onChange({ ...criteria, [label]: value });
  const remove = (label: string) => {
    const next = { ...criteria };
    delete next[label];
    onChange(next);
  };
  const add = () => {
    let i = 1;
    let k = `opt${i}`;
    while (criteria[k]) k = `opt${++i}`;
    onChange({ ...criteria, [k]: "" });
  };

  return (
    <div className="space-y-1.5">
      <div className="section-title">选项（标签 + 判据描述）</div>
      {entries.map(([label, desc]) => (
        <div key={label} className="flex gap-2">
          <input
            className="input w-[120px] font-mono"
            value={label}
            disabled={readOnly}
            onChange={(e) => setLabel(label, e.target.value)}
          />
          <input
            className="input flex-1"
            placeholder="这一项成立的条件，例如：发票、支付、退款"
            value={desc}
            disabled={readOnly}
            onChange={(e) => setValue(label, e.target.value)}
          />
          {!readOnly && entries.length > 2 && (
            <button className="btn btn-sm btn-danger" onClick={() => remove(label)}>
              ×
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button className="btn btn-sm" onClick={add}>
          + 选项
        </button>
      )}
    </div>
  );
}

function ScoreCriteria({
  criteria,
  onChange,
  readOnly,
}: {
  criteria: string[];
  onChange: (c: string[]) => void;
  readOnly?: boolean;
}) {
  const set = (i: number, v: string) => {
    const next = [...criteria];
    next[i] = v;
    onChange(next);
  };
  const remove = (i: number) => onChange(criteria.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-1.5">
      <div className="section-title">等级（从低到高，每级都要写清楚）</div>
      {criteria.map((c, i) => (
        <div key={i} className="flex gap-2">
          <span className="num grid w-8 shrink-0 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-[12px] text-slate-500">
            {i}
          </span>
          <input
            className="input flex-1"
            placeholder={`第 ${i} 级的判据描述`}
            value={c}
            disabled={readOnly}
            onChange={(e) => set(i, e.target.value)}
          />
          {!readOnly && criteria.length > 2 && (
            <button className="btn btn-sm btn-danger" onClick={() => remove(i)}>
              ×
            </button>
          )}
        </div>
      ))}
      {!readOnly && criteria.length < 5 && (
        <button className="btn btn-sm" onClick={() => onChange([...criteria, ""])}>
          + 等级
        </button>
      )}
    </div>
  );
}
