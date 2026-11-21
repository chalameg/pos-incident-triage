import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../lib/store";
import { groupEvents, fixture } from "../lib/triage";
import { DEFAULT_RULES, payloads } from "../lib/domain";
import {
  approve,
  previewProviders,
  ProviderError,
  type Providers,
} from "../lib/escalation";

function setup() {
  const store = new Store(":memory:");
  const run = store.createRun();
  const result = store.replay(run.id, "burst");
  return { store, run, id: result.incidentIds[0] };
}
const destinations = { github: "test/repo", slack: "test-channel" };

test("isolated failures produce one low incident with two attempts and one store", () => {
  const store = new Store(":memory:");
  const run = store.createRun();
  const result = store.replay(run.id, "isolated");
  const incident = store.incident(result.incidentIds[0])!;
  assert.equal(incident.priority, "low");
  assert.equal(incident.failedAttempts, 2);
  assert.equal(incident.stores.length, 1);
  assert.equal(store.list("preview").length, 1);
  store.close();
});
test("burst normalizes signatures, drops duplicate evidence, and replay is idempotent", () => {
  const { store, run, id } = setup();
  const incident = store.incident(id)!;
  assert.equal(incident.priority, "high");
  assert.equal(incident.failedAttempts, 6);
  assert.equal(incident.stores.length, 2);
  assert.equal(incident.events.length, 6);
  const again = store.replay(run.id, "burst");
  assert.equal(again.inserted, 0);
  assert.equal(again.duplicates, 7);
  assert.equal(again.incidentIds[0], id);
  assert.equal(store.list("preview").length, 1);
  store.close();
});
test("repeated attempt evidence is counted once; five-minute end boundary is exclusive", () => {
  const store = new Store(":memory:");
  const run = store.createRun();
  const events = fixture("burst", run).slice(0, 6);
  const sameAttempt = { ...events[0], eventId: "another-event-same-attempt" };
  const boundary = {
    ...events[0],
    eventId: "at-next-window",
    timestamp: new Date(Date.parse(run.anchor) + 300_000).toISOString(),
  };
  const groups = groupEvents(run, [...events, sameAttempt, boundary]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].failedAttempts, 6);
  assert.equal(groups[0].events.length, 7);
  assert.equal(groups[1].failedAttempts, 1);
  store.close();
});
test("priority thresholds are captured per run", () => {
  const store = new Store(":memory:");
  const run = store.createRun({ ...DEFAULT_RULES, highAttempts: 7 });
  const result = store.replay(run.id, "burst");
  assert.equal(store.incident(result.incidentIds[0])!.priority, "low");
  store.close();
});
test("fresh runs preserve earlier incidents and replay IDs are scoped to a run", async () => {
  const { store, id } = setup();
  await approve(store, id, "preview", previewProviders, destinations);
  const next = store.createRun();
  const replay = store.replay(next.id, "burst");
  assert.notEqual(replay.incidentIds[0], id);
  assert.equal(store.list("preview").length, 2);
  assert.equal(store.history(id).length, 2);
  store.close();
});
test("approval persists GitHub before Slack; repeated approval returns recorded result", async () => {
  const { store, id } = setup();
  const calls: string[] = [];
  const providers: Providers = {
    async github() {
      calls.push("github");
      return "https://github.com/test/repo/issues/1";
    },
    async slack(payload) {
      calls.push("slack");
      assert.equal(store.actions(id, "live")[0].state, "succeeded");
      assert.match(payload.text, /https:\/\/github.com\/test\/repo\/issues\/1/);
    },
  };
  await approve(store, id, "live", providers, destinations);
  await approve(store, id, "live", providers, destinations);
  assert.deepEqual(calls, ["github", "slack"]);
  assert.equal(store.history(id).length, 2);
  store.close();
});
test("Slack rejection retains issue URL and retry only sends Slack", async () => {
  const { store, id } = setup();
  let github = 0;
  let slack = 0;
  const providers: Providers = {
    async github() {
      github++;
      return "https://github.com/test/repo/issues/2";
    },
    async slack() {
      slack++;
      if (slack === 1)
        throw new ProviderError("Slack rejected request (HTTP 403).");
    },
  };
  const result = await approve(store, id, "live", providers, destinations);
  assert.equal(result.actions[0].url, "https://github.com/test/repo/issues/2");
  assert.equal(result.actions[1].state, "failed");
  await approve(store, id, "live", providers, destinations);
  assert.equal(github, 1);
  assert.equal(slack, 2);
  store.close();
});
test("concurrent approval requests cannot create duplicate issues or messages", async () => {
  const { store, id } = setup();
  let release!: () => void;
  let github = 0;
  let slack = 0;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const providers: Providers = {
    async github() {
      github++;
      await wait;
      return "https://github.com/test/repo/issues/3";
    },
    async slack() {
      slack++;
    },
  };
  const first = approve(store, id, "live", providers, destinations);
  await assert.rejects(
    approve(store, id, "live", providers, destinations),
    /already in progress/,
  );
  release();
  await first;
  assert.equal(github, 1);
  assert.equal(slack, 1);
  store.close();
});
test("unknown outcomes require destination check before a retry", async () => {
  const { store, id } = setup();
  let calls = 0;
  const providers: Providers = {
    async github() {
      calls++;
      throw new ProviderError("Timed out.", true);
    },
    async slack() {
      assert.fail("Slack must not run");
    },
  };
  await approve(store, id, "live", providers, destinations);
  assert.equal(store.actions(id, "live")[0].state, "unknown");
  await assert.rejects(
    approve(store, id, "live", providers, destinations),
    /Outcome unknown/,
  );
  assert.equal(calls, 1);
  store.resolve(id, "live", "github", "absent", null);
  await approve(store, id, "live", providers, destinations);
  assert.equal(calls, 2);
  store.close();
});
test("operator can reconcile an already-created issue and resume Slack only", async () => {
  const { store, id } = setup();
  await approve(
    store,
    id,
    "live",
    {
      async github() {
        throw new ProviderError("Timeout", true);
      },
      async slack() {},
    },
    destinations,
  );
  store.resolve(
    id,
    "live",
    "github",
    "delivered",
    "https://github.com/test/repo/issues/9",
  );
  let slack = 0;
  await approve(
    store,
    id,
    "live",
    {
      async github() {
        assert.fail("Must reuse issue");
      },
      async slack() {
        slack++;
      },
    },
    destinations,
  );
  assert.equal(slack, 1);
  assert.equal(
    store.actions(id, "live")[0].url,
    "https://github.com/test/repo/issues/9",
  );
  store.close();
});
test("stale running actions become unknown after a process interruption", () => {
  const { store, id } = setup();
  store.claim(
    id,
    "live",
    "github",
    destinations.github,
    payloads(store.incident(id)!).github,
  );
  store.recoverStale(Date.now() + 61_000);
  assert.equal(store.actions(id, "live")[0].state, "unknown");
  assert.equal(store.history(id)[0].status, "unknown");
  store.close();
});
test("SQLite survives closing and reopening, including action history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "triage-"));
  const path = join(dir, "triage.sqlite");
  try {
    const first = new Store(path);
    const run = first.createRun();
    const id = first.replay(run.id, "burst").incidentIds[0];
    await approve(first, id, "preview", previewProviders, destinations);
    first.close();
    const second = new Store(path);
    assert.equal(second.incident(id)!.failedAttempts, 6);
    assert.equal(second.actions(id, "preview")[1].state, "succeeded");
    assert.equal(second.history(id).length, 2);
    assert.equal(second.replay(run.id, "burst").inserted, 0);
    second.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test("preview and live records are separate, and changed destinations are blocked", async () => {
  const { store, id } = setup();
  await approve(store, id, "preview", previewProviders, destinations);
  assert.equal(store.actions(id, "live")[0].state, "pending");
  await assert.rejects(
    approve(store, id, "preview", previewProviders, {
      ...destinations,
      github: "different/repo",
    }),
    /Destination changed/,
  );
  store.close();
});

test("a delayed AI response cannot replace a draft once approval has started", () => {
  const { store, id } = setup();
  const initial = store.incident(id)!;
  store.claim(
    id,
    "preview",
    "github",
    destinations.github,
    payloads(initial).github,
  );
  store.saveSummary(id, {
    ...initial.triage,
    source: "gemini",
    title: "A later draft",
  });
  assert.equal(store.incident(id)!.triage.title, initial.triage.title);
  assert.equal(store.incident(id)!.triage.source, "rule-based");
  store.close();
});
test("independent database connections serialize action claims and reject late completion", () => {
  const dir = mkdtempSync(join(tmpdir(), "triage-concurrency-"));
  const path = join(dir, "triage.sqlite");
  try {
    const first = new Store(path);
    const second = new Store(path);
    const run = first.createRun();
    const id = first.replay(run.id, "burst").incidentIds[0];
    const token = first.claim(id, "live", "github", destinations.github, {})!;
    assert.throws(
      () => second.claim(id, "live", "github", destinations.github, {}),
      /already in progress/,
    );
    second.recoverStale(Date.now() + 61_000);
    second.resolve(id, "live", "github", "absent", null);
    assert.throws(
      () =>
        first.finish(
          token,
          "succeeded",
          "https://github.com/test/repo/issues/100",
          null,
        ),
      /lease expired/,
    );
    assert.equal(second.actions(id, "live")[0].state, "failed");
    assert.equal(second.actions(id, "live")[0].url, null);
    first.close();
    second.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
