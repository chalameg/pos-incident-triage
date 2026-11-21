import "server-only";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { providerTargets, type LiveConfig } from "./providers";
import { Store } from "./store";
import {
  DEFAULT_RULES,
  payloads,
  type DashboardData,
  type Incident,
  type Mode,
  type Rules,
} from "./domain";

const globalDb = globalThis as unknown as { triageStore?: Store };
export function getStore() {
  return (globalDb.triageStore ??= new Store(
    resolve(process.env.SQLITE_PATH || "data/triage.sqlite"),
  ));
}
export function settings() {
  const value = process.env.ESCALATION_MODE || "preview";
  if (!["preview", "live"].includes(value))
    throw new Error("ESCALATION_MODE must be preview or live.");
  const mode = value as Mode;
  return {
    mode,
    destinations: {
      github:
        mode === "preview"
          ? "Simulated demo repository"
          : process.env.GITHUB_REPOSITORY || "Repository not configured",
      slack:
        mode === "preview"
          ? "Simulated demo channel"
          : process.env.SLACK_CHANNEL_LABEL || "Channel not configured",
    },
    liveReady: Boolean(
      process.env.GITHUB_TOKEN &&
      process.env.GITHUB_REPOSITORY &&
      process.env.SLACK_WEBHOOK_URL &&
      process.env.SLACK_CHANNEL_LABEL,
    ),
  };
}
export function rules(): Rules {
  const positive = (value: string | undefined, defaultValue: number) => {
    if (!value) return defaultValue;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1)
      throw new Error("Priority thresholds must be positive integers.");
    return n;
  };
  return {
    ...DEFAULT_RULES,
    highAttempts: positive(process.env.TRIAGE_HIGH_ATTEMPTS, 5),
    highStores: positive(process.env.TRIAGE_HIGH_STORES, 2),
  };
}
export function dashboard(): DashboardData {
  const config = settings();
  const store = getStore();
  return {
    ...config,
    runs: store.runs(),
    incidents: store
      .list(config.mode)
      .map((i) => ({ ...i, reviewToken: reviewToken(i) })),
  };
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const parsed = origin ? new URL(origin) : null;
  // Next can normalize request.url to localhost; compare the browser's Origin to Host.
  if (
    !parsed ||
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.host !== request.headers.get("host") ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  ) {
    throw new Error("A same-origin local browser request is required.");
  }
}
export function errorResponse(error: unknown, status = 400) {
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "The operation could not be completed.",
    },
    { status },
  );
}

export function liveConfig(): LiveConfig {
  return {
    githubToken: process.env.GITHUB_TOKEN || "",
    githubRepository: process.env.GITHUB_REPOSITORY || "",
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || "",
    slackChannelLabel: process.env.SLACK_CHANNEL_LABEL || "",
  };
}
export function reviewToken(incident: Incident): string {
  const config = settings();
  const targets =
    config.mode === "live"
      ? providerTargets(liveConfig())
      : config.destinations;
  return createHash("sha256")
    .update(
      JSON.stringify({
        mode: config.mode,
        targets,
        payloads: payloads(incident),
      }),
    )
    .digest("hex");
}
