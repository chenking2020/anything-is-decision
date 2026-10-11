export type QuestionType = "choice" | "score" | "noul";

export interface QuestionSpec {
  type: QuestionType;
  instructions: string;
  criteria?: Record<string, string> | string[];
  labels?: Record<string, string>;
  /** 链式依赖：依赖哪些因子的结论（上游结论会被写成图上的节点） */
  depends_on?: string[];
  /** 动态子本体的作用域：只关心图上哪些类型 / 关键词，以及几跳邻域 */
  scope?: { types?: string[]; keywords?: string[]; depth?: number };
}

export interface OntologyNode {
  id: string;
  type: "root" | "document" | "attribute" | "concept" | "conclusion";
  label: string;
  value: string;
  weight: number;
  step: number;
  meta: Record<string, any>;
}

export interface OntologyEdge {
  source: string;
  target: string;
  rel: "has" | "mentions" | "co_occurs" | "derives" | string;
  weight: number;
  step: number;
}

export interface OntologyGraph {
  nodes: OntologyNode[];
  edges: OntologyEdge[];
}

export interface ChainStep {
  seq: number;
  round: number;
  layer: number;
  key: string;
  seeds: string[];
  subgraph: OntologyGraph;
  answer: {
    value: string | number;
    display: string;
    type: QuestionType;
    confidence: number;
    gate: GateInfo;
  };
  changed: boolean;
  state_text?: string;
}

export interface ChainResult {
  answers: Record<string, AnswerItem>;
  verdict: "act" | "review" | "escalate";
  avg_confidence: number | null;
  min_confidence: number | null;
  threshold: number;
  usage: { input_tokens?: number; output_tokens?: number };
  elapsed_ms: number;
  model: string;
  graph: OntologyGraph;
  layers: string[][];
  steps: ChainStep[];
  rounds: number;
  converged: boolean;
  chained: boolean;
  unsettled: string[];
  decision_id?: string | null;
  plan?: ChainPlan;
}

export interface ChainPlan {
  layers: string[][];
  edges: { from: string; to: string }[];
  error: string | null;
  count?: number;
}

export interface Blueprint {
  id: string;
  name: string;
  domain: string;
  description: string;
  questions: Record<string, QuestionSpec>;
  state_hint: Record<string, any>;
  sample_states: { label: string; state: any }[];
  policy: {
    threshold?: number;
    act_keys?: string[];
    escalate_keys?: string[];
    note?: string;
    auto_act?: boolean;
    noul_margin?: number;
    cascade?: boolean;
  };
  tags: string[];
  builtin?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProbItem {
  label: string;
  p: number;
  is_answer?: boolean;
}

export interface GateInfo {
  decision: "act" | "escalate";
  reason: string;
  threshold: number;
  confidence: number;
}

export interface AnswerItem {
  key: string;
  type: QuestionType;
  instructions: string;
  temperature: number;
  value: string | number;
  display: string;
  level?: number | null;
  legend?: Record<string, string>;
  probabilities: ProbItem[];
  probabilities_raw: Record<string, number>;
  confidence: number;
  answer_confidence: number;
  boolean?: boolean;
  action?: Record<string, any>;
  gate: GateInfo;
}

export interface RoutingInfo {
  script?: string | null;
  language?: string | null;
  is_english?: boolean;
  undecided?: boolean;
  checkpoint?: string;
  advice?: string;
}

export interface DecideResult {
  answers: Record<string, AnswerItem>;
  usage: { input_tokens?: number; output_tokens?: number };
  model: string;
  elapsed_ms: number;
  verdict: "act" | "review" | "escalate";
  avg_confidence: number | null;
  min_confidence: number | null;
  threshold: number;
  routing: RoutingInfo;
  decision_id?: string | null;
  policy?: any;
}

export interface BatchRow {
  decision_id?: string | null;
  ref?: string | null;
  state_text: string;
  verdict: string;
  avg_confidence: number | null;
  min_confidence: number | null;
  answers: Record<string, AnswerItem>;
  elapsed_ms?: number;
  routing?: string | null;
}

export interface EngineInfo {
  status: string;
  error: string | null;
  checkpoint: string;
  repo: string;
  weights_dir: string;
  encoder: string | null;
  device: string | null;
  dtype?: string | null;
  max_len: number;
  head_max_len: number;
  context_limit: number;
  parameters: number | null;
  temperature_raw: number[];
  load_seconds: number | null;
  calls: number;
  questions_answered: number;
  avg_elapsed_ms: number | null;
  config: Record<string, any>;
  platform: { name: string; tagline: string };
  settings: Settings;
  runtime: { max_len: number; default_threshold: number };
}

export interface Settings {
  threshold: number;
  temperature: { choice: number; score: number; noul: number };
  auto_act: boolean;
  noul_margin: number;
}

export interface LedgerRow {
  id: string;
  created_at: string;
  mode: string;
  batch_id: string | null;
  blueprint_id: string | null;
  blueprint_name: string | null;
  domain: string | null;
  state_text: string;
  state_json: any;
  questions: Record<string, QuestionSpec>;
  answers: Record<string, AnswerItem>;
  verdict: string | null;
  avg_confidence: number | null;
  min_confidence: number | null;
  threshold: number | null;
  elapsed_ms: number | null;
  device: string | null;
  script: string | null;
  tags: string[];
  feedback?: Record<string, string>;
}

export interface LedgerStats {
  total: number;
  by_verdict: Record<string, number>;
  avg_confidence: number | null;
  avg_min_confidence: number | null;
  avg_elapsed_ms: number | null;
  by_domain: { domain: string; count: number }[];
  by_day: { created_at: string; count: number }[];
  confidence_histogram: number[];
  by_script: { script: string; count: number }[];
  feedback_count: number;
}

export interface CalRow {
  decision_id: string;
  created_at: string;
  blueprint_id: string | null;
  blueprint_name: string | null;
  question_key: string;
  type: QuestionType;
  prediction: string | number;
  confidence: number;
  probabilities: Record<string, number>;
  truth: string;
  state_text: string;
}

export interface TypeMetrics {
  n: number;
  accuracy: number | null;
  mean_confidence: number | null;
  ece: number | null;
  brier: number | null;
  mae?: number | null;
}

export interface MetricsBundle {
  samples: number;
  accuracy: number | null;
  mean_confidence: number | null;
  ece: number | null;
  brier: number | null;
  per_type: Record<string, TypeMetrics>;
}

export interface SweepPoint {
  threshold: number;
  coverage: number;
  count: number;
  accuracy: number | null;
  mean_confidence: number | null;
  ece: number | null;
}

export interface FitEntry {
  temperature: number;
  n: number;
  fitted: boolean;
  note?: string;
  nll_before?: number;
  nll_after?: number;
  ece_before?: number | null;
  ece_after?: number | null;
  brier_before?: number | null;
  brier_after?: number | null;
}
