import React from "react";
import type { OntologyGraph, OntologyNode } from "../lib/types";

const TYPE_STYLE: Record<string, { fill: string; ring: string; text: string }> = {
  root: { fill: "#64748b", ring: "#94a3b8", text: "根" },
  document: { fill: "#38bdf8", ring: "#0ea5e9", text: "数据源" },
  attribute: { fill: "#22d3ee", ring: "#06b6d4", text: "属性" },
  concept: { fill: "#a78bfa", ring: "#8b5cf6", text: "概念" },
  conclusion: { fill: "#fbbf24", ring: "#f59e0b", text: "结论" },
};

const REL_COLOR: Record<string, string> = {
  has: "#334155",
  mentions: "#0ea5e9",
  co_occurs: "#7c3aed",
  derives: "#f59e0b",
};

type Pos = { x: number; y: number };

/** 分层环形布局：结论在中心，属性在中环，概念在外环，数据源在角落。 */
function layout(graph: OntologyGraph, w: number, h: number): Record<string, Pos> {
  const cx = w / 2;
  const cy = h / 2;
  const pos: Record<string, Pos> = {};
  const byType = (t: string) => graph.nodes.filter((n) => n.type === t);

  const place = (nodes: OntologyNode[], radius: number, offset = -Math.PI / 2) => {
    if (!nodes.length) return;
    if (nodes.length === 1) {
      pos[nodes[0].id] = { x: cx, y: cy - radius };
      return;
    }
    nodes.forEach((n, i) => {
      const a = offset + (i / nodes.length) * Math.PI * 2;
      pos[n.id] = { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
    });
  };

  const conclusions = byType("conclusion");
  const attrs = byType("attribute");
  const concepts = byType("concept");
  const docs = byType("document").concat(byType("root"));

  place(conclusions, conclusions.length > 3 ? 62 : 44);
  place(attrs, 132);
  // 概念多时分两圈，避免标签挤成一团
  if (concepts.length <= 12) {
    place(concepts, 208);
  } else {
    place(concepts.slice(0, Math.ceil(concepts.length / 2)), 200);
    place(concepts.slice(Math.ceil(concepts.length / 2)), 258, -Math.PI / 2 + 0.25);
  }
  docs.forEach((d, i) => {
    pos[d.id] = { x: 34 + (i % 2) * 0, y: 30 + i * 34 };
  });
  return pos;
}

export default function OntologyGraphView({
  graph,
  height = 460,
  highlight,
}: {
  graph: OntologyGraph | null;
  height?: number;
  highlight?: string[];
}) {
  const w = 720;
  const h = height;
  if (!graph || !graph.nodes.length) {
    return (
      <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-ink-600 text-[12px] text-slate-600">
        还没有图——先点「构建本体」或「运行链式决策」
      </div>
    );
  }
  const pos = layout(graph, w, h);
  const hl = new Set(highlight || []);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full min-w-[640px]">
        {graph.edges.map((e, i) => {
          const a = pos[e.source];
          const b = pos[e.target];
          if (!a || !b) return null;
          const active = hl.has(e.source) || hl.has(e.target);
          return (
            <line
              key={`${e.source}-${e.target}-${e.rel}-${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={REL_COLOR[e.rel] || "#334155"}
              strokeWidth={e.rel === "derives" ? 1.6 : 0.9}
              strokeOpacity={active ? 0.9 : 0.28}
            />
          );
        })}
        {graph.nodes.map((n) => {
          const p = pos[n.id];
          if (!p) return null;
          const st = TYPE_STYLE[n.type] || TYPE_STYLE.concept;
          const r = n.type === "conclusion" ? 7 : n.type === "root" || n.type === "document" ? 5 : 4.5;
          const dim = hl.size > 0 && !hl.has(n.id);
          const label = n.label.length > 10 ? n.label.slice(0, 10) + "…" : n.label;
          return (
            <g key={n.id} opacity={dim ? 0.35 : 1}>
              <circle cx={p.x} cy={p.y} r={r} fill={st.fill} stroke={st.ring} strokeWidth={1} />
              <text
                x={p.x}
                y={p.y - r - 4}
                textAnchor="middle"
                className="pointer-events-none"
                fontSize={9}
                fill={n.type === "conclusion" ? "#fcd34d" : "#cbd5e1"}
              >
                {label}
              </text>
              <title>{`${st.text} · ${n.label}${n.value ? `\n${n.value.slice(0, 120)}` : ""}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
        {Object.entries(TYPE_STYLE).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: v.fill }} />
            {v.text}
          </span>
        ))}
        <span className="ml-auto">
          {graph.nodes.length} 节点 · {graph.edges.length} 边
        </span>
      </div>
    </div>
  );
}
