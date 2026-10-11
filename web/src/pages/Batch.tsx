import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { AnswerItem, Blueprint, BatchRow } from "../lib/types";
import { pct, truthLabel, typeColor, typeLabel, verdictChip, verdictLabel } from "../lib/format";
import { AnswerCard } from "../components/AnswerCard";
import { Empty, ErrorBox, Panel, SectionTitle, Slider, Spinner, Toggle } from "../components/ui";

const SAMPLE_CSV = `id,body
1,"We were billed twice for March, please refund the duplicate today or we cancel."
2,"The app crashes every time I open settings on iOS 17."
3,"我三月份被重复扣款了，请今天退款。"
4,"二重に請求されました。今日中に返金してください。"
5,"Can you send the enterprise quote and the DPA before Friday?"`;

export default function Batch() {
  const { bpId } = useParams();
  const navigate = useNavigate();
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [bp, setBp] = useState<Blueprint | null>(null);
  const [text, setText] = useState(SAMPLE_CSV);
  const [format, setFormat] = useState("auto");
  const [textField, setTextField] = useState("body");
  const [fields, setFields] = useState<string[]>([]);
  const [items, setItems] = useState<{ state: any; ref?: string }[]>([]);
  const [parsed, setParsed] = useState<number | null>(null);
  const [threshold, setThreshold] = useState(0.6);
  const [batchSize, setBatchSize] = useState(16);
  const [cascade, setCascade] = useState(false);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [truths, setTruths] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    api
      .blueprints()
      .then((r) => {
        setBlueprints(r.items);
        if (bpId) {
          const b = r.items.find((x) => x.id === bpId);
          if (b) {
            setBp(b);
            if (b.policy?.threshold != null) setThreshold(b.policy.threshold);
            if (b.policy?.cascade != null) setCascade(b.policy.cascade);
          }
        }
      })
      .catch(() => {});
  }, [bpId]);

  const parse = async () => {
    setError(null);
    try {
      const r = await api.ingestParse({ text, format, text_field: textField || undefined });
      setItems(r.items);
      setFields(r.fields);
      setParsed(r.count);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  const run = async () => {
    if (!bp) {
      setError("请先选择一张蓝图");
      return;
    }
    const list = parsed ? items : (await api.ingestParse({ text, format, text_field: textField || undefined })).items;
    if (!list.length) {
      setError("没有可执行的条目");
      return;
    }
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const res = await api.decideBatch({
        items: list,
        questions: bp.questions,
        policy: { threshold, auto_act: true, noul_margin: 0.15, cascade },
        blueprint_id: bp.id,
        blueprint_name: bp.name,
        domain: bp.domain,
        batch_size: batchSize,
      });
      setRows(res.rows);
      setSummary({ ...res.verdicts, wall: performance.now() - t0, batch_id: res.batch_id, count: res.count });
      setTruths({});
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  const onTruth = async (decisionId: string, key: string, truth: string) => {
    try {
      const r = await api.feedback(decisionId, key, truth);
      setTruths((t) => ({ ...t, [decisionId]: r.feedback }));
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  const exportCsv = () => {
    if (!rows.length || !bp) return;
    const keys = Object.keys(bp.questions);
    const head = ["ref", "state", ...keys.flatMap((k) => [`${k}.answer`, `${k}.confidence`]), "verdict"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")];
    for (const r of rows) {
      const cells = [
        esc(r.ref ?? ""),
        esc(r.state_text),
        ...keys.flatMap((k) => {
          const a = r.answers?.[k] as AnswerItem | undefined;
          return [esc(a?.display ? truthLabel(a.display) : ""), esc(a?.answer_confidence?.toFixed(4))];
        }),
        esc(r.verdict),
      ];
      lines.push(cells.join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anything-is-decision-${bp.id}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const questionKeys = bp ? Object.keys(bp.questions) : [];

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <div className="space-y-4 xl:col-span-5">
        <Panel className="panel-pad">
          <SectionTitle>选择蓝图</SectionTitle>
          <select
            className="select"
            value={bp?.id ?? ""}
            onChange={(e) => {
              const b = blueprints.find((x) => x.id === e.target.value) ?? null;
              setBp(b);
              if (b?.policy?.threshold != null) setThreshold(b.policy.threshold);
              if (b?.policy?.cascade != null) setCascade(b.policy.cascade);
              setRows([]);
            }}
          >
            <option value="">— 请选择 —</option>
            {blueprints.map((b) => (
              <option key={b.id} value={b.id}>
                {b.domain} · {b.name}
              </option>
            ))}
          </select>
          {bp && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(bp.questions).map(([k, q]) => (
                <span key={k} className={`chip ${typeColor[q.type] ?? ""}`}>
                  <span className="font-mono">{k}</span> · {typeLabel[q.type]}
                </span>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="panel-pad">
          <SectionTitle
            right={
              <select className="select w-[130px] py-1 text-[12px]" value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="auto">自动识别</option>
                <option value="csv">CSV</option>
                <option value="json">JSON / JSONL</option>
                <option value="lines">逐行文本</option>
              </select>
            }
          >
            输入数据
          </SectionTitle>
          <textarea className="textarea min-h-[190px]" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          {fields.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11.5px] text-slate-500">文本列</span>
              <select className="select w-[160px] py-1 text-[12px]" value={textField} onChange={(e) => setTextField(e.target.value)}>
                {fields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
                <option value="">（整行作为 JSON 状态）</option>
              </select>
            </div>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-[12px]">
                <span className="text-slate-500">置信阈值</span>
                <span className="num text-accent-soft">{pct(threshold, 0)}</span>
              </div>
              <Slider value={threshold} min={0.3} max={0.95} step={0.01} onChange={setThreshold} />
            </div>
            <div>
              <div className="mb-1 text-[12px] text-slate-500">前向批次大小</div>
              <select className="select py-1 text-[12px]" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))}>
                {[8, 16, 32, 64].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <Toggle
              checked={cascade}
              onChange={setCascade}
              label="级联推理（每条都会逐题串行，延迟 × 问题数）"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn flex-1" onClick={parse}>
              解析预览
            </button>
            <button className="btn btn-primary flex-1" onClick={run} disabled={loading || !bp}>
              {loading ? <Spinner label={`批量推理中`} /> : `批量决策`}
            </button>
          </div>
          {parsed != null && (
            <div className="mt-2 text-[11.5px] text-slate-500">
              已解析 <span className="num text-accent-soft">{parsed}</span> 条
            </div>
          )}
        </Panel>

        {summary && (
          <Panel className="panel-pad">
            <SectionTitle>本次汇总</SectionTitle>
            <div className="grid grid-cols-3 gap-3 text-center">
              {["act", "review", "escalate"].map((v) => (
                <div key={v}>
                  <div className={`num text-[22px] ${v === "act" ? "text-emerald-700" : v === "review" ? "text-sky-700" : "text-amber-700"}`}>
                    {summary[v] ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-500">{verdictLabel[v]}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1 text-[12px] text-slate-500">
              <div className="flex justify-between">
                <span>条目数</span>
                <span className="num text-slate-300">{summary.count}</span>
              </div>
              <div className="flex justify-between">
                <span>总墙钟时间</span>
                <span className="num text-slate-300">{(summary.wall / 1000).toFixed(2)} s</span>
              </div>
              <div className="flex justify-between">
                <span>吞吐</span>
                <span className="num text-slate-300">
                  {(summary.count / (summary.wall / 1000)).toFixed(1)} 条/秒
                </span>
              </div>
            </div>
            <button className="btn mt-3 w-full" onClick={exportCsv}>
              导出 CSV
            </button>
          </Panel>
        )}
      </div>

      <div className="space-y-4 xl:col-span-7">
        <ErrorBox>{error}</ErrorBox>
        {!rows.length ? (
          <Panel className="panel-pad">
            <Empty
              action={
                bp ? (
                  <button className="btn btn-primary btn-sm" onClick={run} disabled={loading}>
                    开始批量决策
                  </button>
                ) : (
                  <button className="btn btn-sm" onClick={() => navigate("/blueprints")}>
                    先去选一张蓝图
                  </button>
                )
              }
            >
              批量模式把同一套问题压进共享前向传播：一次性给上千条工单、交易或日志打分，
              再按置信度自动分流。
            </Empty>
          </Panel>
        ) : (
          <Panel className="overflow-hidden">
            <div className="scroll-thin max-h-[70vh] overflow-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 bg-ink-900/95 backdrop-blur">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">状态摘要</th>
                    {questionKeys.map((k) => (
                      <th key={k} className="px-3 py-2 font-medium">
                        {k}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium">置信</th>
                    <th className="px-3 py-2 font-medium">裁决</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-600">
                  {rows.map((r, i) => (
                    <React.Fragment key={r.decision_id ?? i}>
                      <tr
                        className="cursor-pointer transition hover:bg-ink-800"
                        onClick={() => setExpanded(expanded === (r.decision_id ?? String(i)) ? null : (r.decision_id ?? String(i)))}
                      >
                        <td className="num px-3 py-2 text-slate-600">{r.ref ?? i + 1}</td>
                        <td className="max-w-[260px] truncate px-3 py-2 text-slate-400">{r.state_text?.slice(0, 80)}</td>
                        {questionKeys.map((k) => {
                          const a = r.answers?.[k] as AnswerItem | undefined;
                          return (
                            <td key={k} className="px-3 py-2">
                              <span className={a?.gate?.decision === "act" ? "text-slate-200" : "text-amber-700/90"}>
                                {a?.display ? truthLabel(a.display) : "—"}
                              </span>
                            </td>
                          );
                        })}
                        <td className="num px-3 py-2 text-slate-400">{pct(r.avg_confidence)}</td>
                        <td className="px-3 py-2">
                          <span className={verdictChip[r.verdict] ?? "chip"}>{verdictLabel[r.verdict] ?? r.verdict}</span>
                        </td>
                      </tr>
                      {expanded === (r.decision_id ?? String(i)) && (
                        <tr>
                          <td colSpan={questionKeys.length + 4} className="bg-ink-800 px-3 py-3">
                            <div className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-600 bg-ink-800 p-2.5 text-[11.5px] text-slate-400">
                              {r.state_text}
                            </div>
                            <div className="grid gap-3 lg:grid-cols-2">
                              {Object.values(r.answers).map((a) => (
                                <AnswerCard
                                  key={a.key}
                                  answer={a}
                                  truth={truths[r.decision_id ?? ""]?.[a.key]}
                                  onTruth={(t) => r.decision_id && onTruth(r.decision_id, a.key, t)}
                                />
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
