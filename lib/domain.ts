export type Scenario = "isolated" | "burst";
export type Mode = "preview" | "live";
export type Provider = "github" | "slack";
export type ActionState =
  "pending" | "running" | "succeeded" | "failed" | "unknown";
export interface Rules {
  windowMinutes: number;
  highAttempts: number;
  highStores: number;
}
export const DEFAULT_RULES: Rules = {
  windowMinutes: 5,
  highAttempts: 5,
  highStores: 2,
};
export const STORES: Record<string, string> = {
  "store-01": "Juniper Kitchen",
  "store-02": "Copper Table",
};
export interface Run {
  id: string;
  createdAt: string;
  anchor: string;
  rules: Rules;
}
export interface CheckoutEvent {
  eventId: string;
  attemptId: string;
  timestamp: string;
  storeId: string;
  stage: "payment" | "receipt";
  errorCode: string;
  message: string;
}
export interface Facts {
  id: string;
  runId: string;
  signature: string;
  stage: CheckoutEvent["stage"];
  errorCode: string;
  windowStart: string;
  windowEnd: string;
  stores: string[];
  failedAttempts: number;
  priority: "high" | "low";
  rules: Rules;
  events: CheckoutEvent[];
}
export interface Summary {
  source: "gemini" | "rule-based";
  reason?: string;
  title: string;
  summary: string;
  observedImpact: { failedAttempts: number; affectedStores: number };
  evidenceIds: string[];
  unknowns: string[];
  suggestedNextCheck: string;
}
export interface Incident extends Facts {
  triage: Summary;
}
export interface Action {
  incidentId: string;
  mode: Mode;
  provider: Provider;
  state: ActionState;
  attempts: number;
  url: string | null;
  error: string | null;
  updatedAt: string | null;
  target: string | null;
}
export interface History {
  id: number;
  provider: Provider;
  mode: Mode;
  status: string;
  payload: string;
  createdAt: string;
  completedAt: string | null;
  note: string | null;
}
export interface IncidentView extends Incident {
  actions: Action[];
  history: History[];
}
export interface DashboardData {
  runs: Run[];
  incidents: (IncidentView & { reviewToken: string })[];
  mode: Mode;
  destinations: { github: string; slack: string };
  liveReady: boolean;
}
export const normalizeCode = (code: string) =>
  code
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

export const NEXT_CHECKS = [
  "Correlate the payment timeout evidence with gateway health and request logs; verify payment outcomes before retrying.",
  "Check the receipt printer connection and queue for the affected store; verify checkout completion separately.",
] as const;
export const UNKNOWNS = [
  "Root cause is not established.",
  "Payment outcomes and customer impact are not confirmed.",
  "Total successful checkouts and failure rate are unknown.",
] as const;
export function fallback(
  f: Facts,
  reason = "Gemini credentials or model are not configured.",
): Summary {
  return {
    source: "rule-based",
    reason,
    title: `${f.errorCode === "GATEWAY_TIMEOUT" ? "Payment authorization timeouts" : "Receipt printer timeouts"} across ${f.stores.length} ${f.stores.length === 1 ? "store" : "stores"}`,
    summary: `${f.failedAttempts} distinct checkout attempts recorded ${f.stage} failures across ${f.stores.length} ${f.stores.length === 1 ? "store" : "stores"} in a ${f.rules.windowMinutes}-minute window.`,
    observedImpact: {
      failedAttempts: f.failedAttempts,
      affectedStores: f.stores.length,
    },
    evidenceIds: f.events.map((e) => e.eventId),
    unknowns: [...UNKNOWNS],
    suggestedNextCheck: NEXT_CHECKS[f.stage === "payment" ? 0 : 1],
  };
}

export function payloads(
  incident: Incident,
  issueUrl = "[GitHub issue URL available after creation]",
) {
  const stores = incident.stores
    .map((id) => `${STORES[id] ?? id} (${id})`)
    .join(", ");
  return {
    github: {
      title: `[${incident.priority.toUpperCase()}] ${incident.triage.title} · ${incident.id}`,
      body: [
        "## Synthetic POS incident",
        `Incident: ${incident.id}`,
        `Run: ${incident.runId}`,
        `Priority: ${incident.priority.toUpperCase()}`,
        `Window (UTC): ${incident.windowStart} to ${incident.windowEnd} (end exclusive)`,
        `Signature: ${incident.signature}`,
        `Affected stores: ${stores}`,
        `Distinct failed checkout attempts: ${incident.failedAttempts}`,
        "",
        `Priority rule: high when at least ${incident.rules.highAttempts} attempts fail across at least ${incident.rules.highStores} stores in ${incident.rules.windowMinutes} minutes.`,
        "",
        "## Observed impact",
        incident.triage.summary,
        "",
        "## Supporting evidence",
        ...incident.events.map(
          (e) =>
            `- ${e.eventId} | ${e.attemptId} | ${e.storeId} | ${e.timestamp} | ${e.stage} | ${normalizeCode(e.errorCode)} | ${e.message}`,
        ),
        "",
        "## Suggested first check",
        incident.triage.suggestedNextCheck,
        "",
        "## Unknowns",
        ...incident.triage.unknowns.map((s) => `- ${s}`),
        "",
        `Summary source: ${incident.triage.source}. Human approval required; no root cause asserted.`,
      ].join("\n"),
    },
    slack: {
      text: `[SYNTHETIC DEMO] ${incident.priority.toUpperCase()} · ${incident.id}\n${incident.triage.summary}\nStores: ${stores}\nGitHub issue: ${issueUrl}`,
    },
  };
}
