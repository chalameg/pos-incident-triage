import { fixture, groupEvents } from "./triage";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_RULES,
  fallback,
  type Action,
  type ActionState,
  type CheckoutEvent,
  type History,
  type Incident,
  type IncidentView,
  type Mode,
  type Provider,
  type Rules,
  type Run,
  type Scenario,
  type Summary,
} from "./domain";

type Row = Record<string, string | number | null>;
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (run_id TEXT REFERENCES runs(id), event_id TEXT, data TEXT NOT NULL, PRIMARY KEY(run_id,event_id));
      CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS actions (incident_id TEXT REFERENCES incidents(id), mode TEXT, provider TEXT, state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, url TEXT, error TEXT, updated_at TEXT, target TEXT, token TEXT,
        PRIMARY KEY(incident_id,mode,provider));
      CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id TEXT REFERENCES incidents(id), mode TEXT,
        provider TEXT, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, note TEXT, token TEXT);
    `);
  }
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = work();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  createRun(rules: Rules = DEFAULT_RULES): Run {
    const createdAt = new Date().toISOString();
    const run: Run = {
      id: randomUUID(),
      createdAt,
      anchor: new Date(
        Math.floor(Date.now() / 300_000) * 300_000,
      ).toISOString(),
      rules,
    };
    this.db
      .prepare("INSERT INTO runs VALUES(?,?,?)")
      .run(run.id, createdAt, JSON.stringify(run));
    return run;
  }
  runs(): Run[] {
    return (
      this.db
        .prepare("SELECT data FROM runs ORDER BY created_at DESC, rowid DESC")
        .all() as Row[]
    ).map((r) => JSON.parse(r.data as string));
  }
  run(id: string): Run | undefined {
    const r = this.db.prepare("SELECT data FROM runs WHERE id=?").get(id) as
      Row | undefined;
    return r && JSON.parse(r.data as string);
  }
  replay(runId: string, scenario: Scenario) {
    return this.transaction(() => {
      const run = this.run(runId);
      if (!run) throw new Error("Run not found.");
      const input = fixture(scenario, run);
      let inserted = 0;
      for (const e of input)
        inserted += Number(
          this.db
            .prepare("INSERT OR IGNORE INTO events VALUES(?,?,?)")
            .run(runId, e.eventId, JSON.stringify(e)).changes,
        );
      const events: CheckoutEvent[] = (
        this.db
          .prepare("SELECT data FROM events WHERE run_id=?")
          .all(runId) as Row[]
      ).map((r) => JSON.parse(r.data as string));
      const facts = groupEvents(run, events);
      for (const f of facts) {
        this.db
          .prepare("INSERT OR IGNORE INTO incidents VALUES(?,?,?)")
          .run(f.id, runId, JSON.stringify({ ...f, triage: fallback(f) }));
      }
      const targetIds = groupEvents(run, input).map((f) => f.id);
      return {
        incidentIds: targetIds,
        received: input.length,
        inserted,
        duplicates: input.length - inserted,
      };
    });
  }
  incident(id: string): Incident | undefined {
    const r = this.db
      .prepare("SELECT data FROM incidents WHERE id=?")
      .get(id) as Row | undefined;
    return r && JSON.parse(r.data as string);
  }
  saveSummary(id: string, triage: Summary) {
    const incident = this.incident(id);
    if (!incident) throw new Error("Incident not found.");
    // Freeze a reviewed draft as soon as any action has been claimed.
    this.db
      .prepare(
        "UPDATE incidents SET data=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM actions WHERE incident_id=?)",
      )
      .run(JSON.stringify({ ...incident, triage }), id, id);
  }
  actions(id: string, mode: Mode): Action[] {
    return (["github", "slack"] as Provider[]).map((provider) => {
      const r = this.db
        .prepare(
          "SELECT * FROM actions WHERE incident_id=? AND mode=? AND provider=?",
        )
        .get(id, mode, provider) as Row | undefined;
      return {
        incidentId: id,
        mode,
        provider,
        state: (r?.state ?? "pending") as ActionState,
        attempts: Number(r?.attempts ?? 0),
        url: (r?.url as string) ?? null,
        error: (r?.error as string) ?? null,
        updatedAt: (r?.updated_at as string) ?? null,
        target: (r?.target as string) ?? null,
      };
    });
  }
  history(id: string): History[] {
    return (
      this.db
        .prepare("SELECT * FROM history WHERE incident_id=? ORDER BY id DESC")
        .all(id) as Row[]
    ).map((r) => ({
      id: Number(r.id),
      provider: r.provider as Provider,
      mode: r.mode as Mode,
      status: r.status as string,
      payload: r.payload as string,
      createdAt: r.created_at as string,
      completedAt: r.completed_at as string | null,
      note: r.note as string | null,
    }));
  }
  /** An interrupted process must never silently retry a possibly delivered action. */
  recoverStale(now = Date.now()) {
    this.transaction(() => {
      const cutoff = new Date(now - 60_000).toISOString();
      this.db
        .prepare(
          "UPDATE history SET status='unknown', note='Process interrupted or action lease expired. Check destination before retrying.', completed_at=? WHERE status='running' AND created_at<?",
        )
        .run(new Date(now).toISOString(), cutoff);
      this.db
        .prepare(
          "UPDATE actions SET state='unknown', error='Process interrupted or action lease expired. Check destination before retrying.', token=NULL WHERE state='running' AND updated_at<?",
        )
        .run(cutoff);
    });
  }
  view(id: string, mode: Mode): IncidentView | undefined {
    const incident = this.incident(id);
    return (
      incident && {
        ...incident,
        actions: this.actions(id, mode),
        history: this.history(id),
      }
    );
  }
  list(mode: Mode): IncidentView[] {
    this.recoverStale();
    return (
      this.db
        .prepare("SELECT id FROM incidents ORDER BY rowid DESC")
        .all() as Row[]
    ).map((r) => this.view(r.id as string, mode)!);
  }
  claim(
    id: string,
    mode: Mode,
    provider: Provider,
    target: string,
    payload: unknown,
  ): string | null {
    return this.transaction(() => {
      const current = this.actions(id, mode).find(
        (a) => a.provider === provider,
      )!;
      if (current.target && current.target !== target)
        throw new Error(
          "Destination changed since the first attempt. Restore the original destination before continuing.",
        );
      if (current.state === "succeeded") return null;
      if (current.state === "running")
        throw new Error(
          "An approval is already in progress. Refresh to see the result.",
        );
      if (current.state === "unknown")
        throw new Error(
          "Outcome unknown. Check the destination and record the result before retrying.",
        );
      const token = randomUUID();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO actions VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(incident_id,mode,provider)
        DO UPDATE SET state='running', attempts=actions.attempts+1, error=NULL, updated_at=excluded.updated_at, token=excluded.token`,
        )
        .run(id, mode, provider, "running", 1, null, null, now, target, token);
      this.db
        .prepare(
          "INSERT INTO history(incident_id,mode,provider,status,payload,created_at,token) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          id,
          mode,
          provider,
          "running",
          JSON.stringify(payload),
          now,
          token,
        );
      return token;
    });
  }
  finish(
    token: string,
    state: "succeeded" | "failed" | "unknown",
    url: string | null,
    error: string | null,
  ) {
    this.transaction(() => {
      const now = new Date().toISOString();
      const result = this.db
        .prepare(
          "UPDATE actions SET state=?,url=?,error=?,updated_at=?,token=NULL WHERE token=? AND state='running'",
        )
        .run(state, url, error, now, token);
      if (Number(result.changes) !== 1)
        throw new Error(
          "Action lease expired. Check the destination before continuing.",
        );
      this.db
        .prepare(
          "UPDATE history SET status=?,completed_at=?,note=? WHERE token=?",
        )
        .run(state, now, error, token);
    });
  }
  resolve(
    id: string,
    mode: Mode,
    provider: Provider,
    resolution: "delivered" | "absent",
    url: string | null,
  ) {
    this.transaction(() => {
      const action = this.actions(id, mode).find(
        (a) => a.provider === provider,
      )!;
      if (action.state !== "unknown")
        throw new Error("Only an unknown outcome can be reconciled.");
      const now = new Date().toISOString();
      const note =
        resolution === "delivered"
          ? "Operator checked destination and confirmed delivery."
          : "Operator checked destination and confirmed absence; retry authorized on next approval.";
      this.db
        .prepare(
          "UPDATE actions SET state=?,url=?,error=?,updated_at=? WHERE incident_id=? AND mode=? AND provider=?",
        )
        .run(
          resolution === "delivered" ? "succeeded" : "failed",
          url,
          resolution === "absent" ? note : null,
          now,
          id,
          mode,
          provider,
        );
      this.db
        .prepare(
          "INSERT INTO history(incident_id,mode,provider,status,payload,created_at,completed_at,note) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          mode,
          provider,
          `confirmed-${resolution}`,
          "{}",
          now,
          now,
          note,
        );
    });
  }
}
