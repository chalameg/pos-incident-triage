import { createHash } from "node:crypto";
import {
  normalizeCode,
  type Scenario,
  type Run,
  type CheckoutEvent,
  type Facts,
} from "./domain";

export function fixture(scenario: Scenario, run: Run): CheckoutEvent[] {
  const count = scenario === "burst" ? 6 : 2;
  const events: CheckoutEvent[] = Array.from({ length: count }, (_, i) => ({
    eventId: `${scenario}-event-${i + 1}`,
    attemptId: `${scenario}-attempt-${i + 1}`,
    timestamp: new Date(Date.parse(run.anchor) + i * 25_000).toISOString(),
    storeId: scenario === "burst" && i >= 3 ? "store-02" : "store-01",
    stage: scenario === "burst" ? "payment" : "receipt",
    errorCode:
      scenario === "burst"
        ? i % 2
          ? " gateway-timeout "
          : "GATEWAY_TIMEOUT"
        : "PRINTER_TIMEOUT",
    message:
      scenario === "burst"
        ? "Synthetic payment authorization timed out; payment outcome unknown."
        : "Synthetic receipt printer did not acknowledge the print request.",
  }));
  return scenario === "burst" ? [...events, { ...events[1] }] : events;
}

/** Fixed, UTC-aligned, half-open windows: [start, end). */
export function groupEvents(run: Run, input: CheckoutEvent[]): Facts[] {
  const unique = [...new Map(input.map((e) => [e.eventId, e])).values()];
  const groups = new Map<string, CheckoutEvent[]>();
  const width = run.rules.windowMinutes * 60_000;
  for (const e of unique) {
    const start = Math.floor(Date.parse(e.timestamp) / width) * width;
    const key = `${e.stage}:${normalizeCode(e.errorCode)}:${start}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()].map(([key, events]) => {
    events.sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) ||
        a.eventId.localeCompare(b.eventId),
    );
    const first = events[0];
    const start = Math.floor(Date.parse(first.timestamp) / width) * width;
    const stores = [...new Set(events.map((e) => e.storeId))].sort();
    const failedAttempts = new Set(
      events.map((e) => `${e.storeId}:${e.attemptId}`),
    ).size;
    return {
      id: `INC-${createHash("sha256").update(`${run.id}:${key}`).digest("hex").slice(0, 12).toUpperCase()}`,
      runId: run.id,
      signature: `${first.stage} / ${normalizeCode(first.errorCode)}`,
      stage: first.stage,
      errorCode: normalizeCode(first.errorCode),
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(start + width).toISOString(),
      stores,
      failedAttempts,
      priority:
        failedAttempts >= run.rules.highAttempts &&
        stores.length >= run.rules.highStores
          ? "high"
          : "low",
      rules: run.rules,
      events,
    };
  });
}
