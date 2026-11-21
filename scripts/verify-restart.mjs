import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

// Exercise the real production server and the default durable database.
const origin = "http://127.0.0.1:3111";
let server;
let logs = "";
async function start() {
  logs = "";
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3111",
    ],
    {
      env: {
        ...process.env,
        ESCALATION_MODE: "preview",
        GEMINI_API_KEY: "",
        GEMINI_MODEL: "",
        SQLITE_PATH: "data/triage.sqlite",
        TRIAGE_HIGH_ATTEMPTS: "5",
        TRIAGE_HIGH_STORES: "2",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  server.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error(`Server exited before readiness: ${logs}`);
    try {
      const response = await fetch(`${origin}/api/incidents`);
      if (response.ok) return;
    } catch {}
    await delay(300);
  }
  throw new Error(`Server did not become ready: ${logs}`);
}
async function stop() {
  if (server && server.exitCode === null) {
    const ended = once(server, "exit");
    server.kill("SIGTERM");
    await ended;
  }
}
async function post(path, data) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}
try {
  await start();
  assert.equal((await fetch(origin)).status, 200);
  const { run } = await post("/api/runs", {});
  const replay = await post("/api/replay", {
    runId: run.id,
    scenario: "burst",
  });
  const id = replay.replay.incidentIds[0];
  const incident = replay.incidents.find((i) => i.id === id);
  assert.equal(incident.priority, "high");
  assert.equal(incident.failedAttempts, 6);
  assert.equal(incident.triage.source, "rule-based");
  const approved = await post(`/api/incidents/${id}/approve`, {
    approved: true,
    reviewToken: incident.reviewToken,
  });
  assert.deepEqual(
    approved.incidents.find((i) => i.id === id).actions.map((a) => a.state),
    ["succeeded", "succeeded"],
  );
  await post("/api/replay", { runId: run.id, scenario: "isolated" });
  console.log(
    `Production preview completed for ${id}; stopping and restarting the server.`,
  );
  await stop();
  await start();
  const after = await (await fetch(`${origin}/api/incidents`)).json();
  const persisted = after.incidents.find((i) => i.id === id);
  assert.equal(persisted.failedAttempts, 6);
  assert.equal(persisted.events.length, 6);
  assert.equal(persisted.history.length, 2);
  assert.deepEqual(
    persisted.actions.map((a) => a.state),
    ["succeeded", "succeeded"],
  );
  const repeated = await post("/api/replay", {
    runId: run.id,
    scenario: "burst",
  });
  assert.equal(repeated.replay.inserted, 0);
  assert.equal(repeated.incidents.find((i) => i.id === id).history.length, 2);
  assert.equal(repeated.incidents.filter((i) => i.runId === run.id).length, 2);
  console.log(
    "PASS: production HTTP flow, default data/triage.sqlite, incident evidence, escalation history, restart persistence, and replay idempotency.",
  );
} finally {
  await stop();
}
