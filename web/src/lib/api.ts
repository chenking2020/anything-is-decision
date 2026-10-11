import type {
  Blueprint,
  CalRow,
  ChainPlan,
  ChainResult,
  DecideResult,
  EngineInfo,
  FitEntry,
  LedgerRow,
  LedgerStats,
  MetricsBundle,
  OntologyGraph,
  QuestionSpec,
  Settings,
  SweepPoint,
} from "./types";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
const put = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "PUT", body: JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });

export const api = {
  meta: () => request<EngineInfo>("/api/meta"),
  health: () => request<{ ok: boolean; status: string }>("/api/health"),
  preload: () => post<EngineInfo>("/api/engine/preload", {}),
  route: (state: unknown) => post<any>("/api/route", { state }),

  decide: (payload: {
    state: unknown;
    questions: Record<string, QuestionSpec>;
    policy?: any;
    max_len?: number;
    blueprint_id?: string;
    blueprint_name?: string;
    domain?: string;
    tags?: string[];
    record?: boolean;
  }) => post<DecideResult>("/api/decide", payload),

  decideBatch: (payload: {
    items: { state: unknown; ref?: string }[];
    questions: Record<string, QuestionSpec>;
    policy?: any;
    blueprint_id?: string;
    blueprint_name?: string;
    domain?: string;
    batch_size?: number;
    max_len?: number;
    record?: boolean;
  }) =>
    post<{
      batch_id: string;
      count: number;
      rows: any[];
      verdicts: Record<string, number>;
      policy: any;
      questions: Record<string, QuestionSpec>;
    }>("/api/decide/batch", payload),

  ingestParse: (payload: { text: string; format?: string; text_field?: string }) =>
    post<{ items: { state: any; ref?: string }[]; count: number; fields: string[]; format: string }>(
      "/api/ingest/parse",
      payload
    ),

  // ── 本体与链式决策 ──
  chainDemo: () =>
    request<{ state: any; questions: Record<string, QuestionSpec>; policy: any; max_steps: number }>(
      "/api/chain/demo"
    ),
  buildOntology: (payload: {
    state?: unknown;
    sources?: { id?: string; text?: string; data?: any }[];
    top_concepts?: number;
  }) =>
    post<{
      graph: OntologyGraph;
      stats: { nodes: number; edges: number; by_type: Record<string, number>; by_rel: Record<string, number> };
      bundle: { docs: { id: string; text: string }[]; attributes: { key: string; value: string }[] };
      rendered: string;
    }>("/api/ontology/build", payload),

  chainPlan: (questions: Record<string, QuestionSpec>) => post<ChainPlan>("/api/chain/plan", { questions }),

  decideChain: (payload: {
    state?: unknown;
    sources?: { id?: string; text?: string; data?: any }[];
    questions: Record<string, QuestionSpec>;
    policy?: any;
    max_len?: number;
    max_steps?: number;
    depth?: number;
    limit?: number;
    top_concepts?: number;
    include_state_text?: boolean;
    blueprint_id?: string;
    blueprint_name?: string;
    domain?: string;
    record?: boolean;
  }) => post<ChainResult>("/api/decide/chain", payload),

  blueprints: (domain?: string) =>
    request<{ items: Blueprint[]; domains: string[]; count: number }>(
      `/api/blueprints${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`
    ),
  blueprint: (id: string) => request<Blueprint>(`/api/blueprints/${id}`),
  createBlueprint: (bp: Partial<Blueprint>) => post<Blueprint>("/api/blueprints", bp),
  updateBlueprint: (id: string, bp: Partial<Blueprint>) => put<Blueprint>(`/api/blueprints/${id}`, bp),
  deleteBlueprint: (id: string) => del<{ ok: boolean }>(`/api/blueprints/${id}`),

  ledger: (params: Record<string, string | number | undefined> = {}) => {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return request<{ items: LedgerRow[]; count: number }>(`/api/ledger${qs ? `?${qs}` : ""}`);
  },
  ledgerStats: () => request<LedgerStats>("/api/ledger/stats"),
  decision: (id: string) => request<LedgerRow>(`/api/ledger/${id}`),
  deleteDecision: (id: string) => del<{ ok: boolean }>(`/api/ledger/${id}`),
  clearLedger: () => del<{ ok: boolean }>("/api/ledger"),
  feedback: (id: string, question_key: string, truth: string) =>
    post<{ ok: boolean; feedback: Record<string, string> }>(`/api/ledger/${id}/feedback`, {
      question_key,
      truth,
    }),

  calRows: (params: { blueprint_id?: string; type?: string; limit?: number } = {}) => {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return request<{ items: CalRow[]; count: number }>(`/api/calibration/rows${qs ? `?${qs}` : ""}`);
  },
  calMetrics: (payload: { blueprint_id?: string; type?: string; temperature?: any } = {}) =>
    post<{ metrics: MetricsBundle; n: number }>("/api/calibration/metrics", payload),
  calSweep: (payload: { blueprint_id?: string; type?: string; temperature?: any; steps?: number } = {}) =>
    post<{ curve: SweepPoint[]; n: number; metrics: MetricsBundle }>("/api/calibration/sweep", payload),
  calFit: (payload: { blueprint_id?: string; type?: string } = {}) =>
    post<{ fit: Record<string, FitEntry>; n: number; metrics: MetricsBundle }>("/api/calibration/fit", payload),
  calApply: (temperature: Record<string, number>) =>
    post<{ ok: boolean; settings: Settings }>("/api/calibration/apply", { temperature }),

  settings: () => request<Settings>("/api/settings"),
  putSettings: (patch: Partial<Settings>) => put<Settings>("/api/settings", patch),
};
