import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../lib/store";
import { fallback, payloads, type Facts } from "../lib/domain";
import { generateSummary, validateSummary } from "../lib/gemini";
import {
  liveProviders,
  providerTargets,
  validIssueUrl,
  type LiveConfig,
} from "../lib/providers";
import { ProviderError } from "../lib/escalation";

function facts(): Facts {
  const db = new Store(":memory:");
  const run = db.createRun();
  const id = db.replay(run.id, "burst").incidentIds[0];
  const result = db.incident(id)!;
  db.close();
  return result;
}
const mockFetch = (
  fn: (url: string, options?: RequestInit) => Promise<Response>,
) => fn as typeof fetch;
const geminiConfig = { apiKey: "mock-gemini-key", model: "mock-model" };
function draft(f: Facts) {
  const {
    title,
    summary,
    observedImpact,
    evidenceIds,
    unknowns,
    suggestedNextCheck,
  } = fallback(f);
  return {
    title,
    summary,
    observedImpact,
    evidenceIds,
    unknowns,
    suggestedNextCheck,
  };
}
const candidate = (body: unknown) =>
  Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(body) }] },
      },
    ],
  });

test("missing Gemini credentials return a labeled deterministic fallback without network", async () => {
  const f = facts();
  const result = await generateSummary(
    f,
    {},
    mockFetch(async () => {
      assert.fail("No network expected");
    }),
  );
  assert.equal(result.source, "rule-based");
  assert.match(result.reason!, /not configured/);
  assert.equal(result.summary, fallback(f).summary);
});
test("valid Gemini draft is grounded, schema constrained, and never controls priority", async () => {
  const f = facts();
  const result = await generateSummary(
    f,
    geminiConfig,
    mockFetch(async (url, options) => {
      assert.match(url, /mock-model:generateContent$/);
      assert.equal(
        (options?.headers as Record<string, string>)["x-goog-api-key"],
        "mock-gemini-key",
      );
      const body = JSON.parse(options?.body as string);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.ok(body.generationConfig.responseJsonSchema);
      assert.equal(
        JSON.parse(body.contents[0].parts[0].text).failedAttempts,
        6,
      );
      assert.equal(body.tools, undefined);
      return candidate(draft(f));
    }),
  );
  assert.equal(result.source, "gemini");
  assert.equal(result.observedImpact.failedAttempts, 6);
  assert.equal(f.priority, "high");
  assert.ok(result.unknowns.includes("Root cause is not established."));
});
test("invalid counts, invented evidence, unsupported claims, and unexpected fields all fall back", async () => {
  const f = facts();
  for (const invalid of [
    { ...draft(f), observedImpact: { failedAttempts: 900, affectedStores: 2 } },
    { ...draft(f), evidenceIds: ["invented-event"] },
    { ...draft(f), summary: "All stores are down and revenue has been lost." },
    { ...draft(f), priority: "low" },
    { ...draft(f), suggestedNextCheck: "Refund all payments." },
    { ...draft(f), evidenceIds: ["burst-event-1", "burst-event-1"] },
  ]) {
    const result = await generateSummary(
      f,
      geminiConfig,
      mockFetch(async () => candidate(invalid)),
    );
    assert.equal(result.source, "rule-based");
    assert.match(result.reason!, /validation/);
  }
  assert.throws(() =>
    validateSummary(f, {
      ...draft(f),
      unknowns: ["The gateway is definitely down."],
    }),
  );
});
test("Gemini API rejection, invalid JSON, truncation, network errors, and invalid model use fallback", async () => {
  const f = facts();
  const responses = [
    new Response("rate limit", { status: 429 }),
    Response.json({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "{invalid" }] } },
      ],
    }),
    Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] }),
    Response.json({}),
  ];
  for (const response of responses)
    assert.equal(
      (
        await generateSummary(
          f,
          geminiConfig,
          mockFetch(async () => response),
        )
      ).source,
      "rule-based",
    );
  assert.equal(
    (
      await generateSummary(
        f,
        geminiConfig,
        mockFetch(async () => {
          throw new Error("network failed with secret-token");
        }),
      )
    ).reason,
    "Gemini was unavailable or timed out.",
  );
  assert.equal(
    (
      await generateSummary(
        f,
        { ...geminiConfig, model: "bad/model?key=secret" },
        mockFetch(async () => {
          assert.fail("Invalid model must not call provider");
        }),
      )
    ).source,
    "rule-based",
  );
});
const live: LiveConfig = {
  githubToken: "mock-token",
  githubRepository: "demo/pos-incidents",
  slackWebhookUrl: "https://hooks.slack.com/services/TMOCK/BMOCK/FAKE",
  slackChannelLabel: "#synthetic-demo",
};
test("live adapters send expected GitHub and Slack requests using injected mock fetch", async () => {
  const calls: string[] = [];
  const f = facts();
  const incident = { ...f, triage: fallback(f) };
  const providers = liveProviders(
    live,
    mockFetch(async (url, options) => {
      calls.push(url);
      assert.equal(options?.method, "POST");
      assert.equal(options?.redirect, "error");
      assert.ok(options?.signal);
      if (url.includes("api.github.com")) {
        assert.equal(
          (options?.headers as Record<string, string>).Authorization,
          "Bearer mock-token",
        );
        assert.match(
          JSON.parse(options?.body as string).body,
          /Distinct failed checkout attempts: 6/,
        );
        return Response.json(
          { html_url: "https://github.com/demo/pos-incidents/issues/42" },
          { status: 201 },
        );
      }
      assert.equal(
        (options?.headers as Record<string, string>).Authorization,
        undefined,
      );
      assert.match(JSON.parse(options?.body as string).text, /issues\/42/);
      return new Response("ok");
    }),
  );
  const url = await providers.github(payloads(incident).github, incident);
  await providers.slack(payloads(incident, url).slack);
  assert.deepEqual(calls, [
    "https://api.github.com/repos/demo/pos-incidents/issues",
    live.slackWebhookUrl,
  ]);
});
test("definite HTTP rejection is retryable; timeouts, 5xx, and malformed successes are uncertain", async () => {
  const f = facts();
  const incident = { ...f, triage: fallback(f) };
  for (const [status, uncertain] of [
    [403, false],
    [429, false],
    [408, true],
    [500, true],
  ] as const) {
    const providers = liveProviders(
      live,
      mockFetch(async () => new Response("not logged: secret", { status })),
    );
    await assert.rejects(
      providers.github(payloads(incident).github, incident),
      (e) =>
        e instanceof ProviderError &&
        e.uncertain === uncertain &&
        !e.message.includes("secret"),
    );
  }
  for (const response of [
    Response.json(
      { html_url: "https://attacker.example/issue" },
      { status: 201 },
    ),
    new Response("invalid json", { status: 201 }),
    new Response("{}", { status: 200 }),
  ]) {
    await assert.rejects(
      liveProviders(
        live,
        mockFetch(async () => response),
      ).github(payloads(incident).github, incident),
      (e) => e instanceof ProviderError && e.uncertain,
    );
  }
  await assert.rejects(
    liveProviders(
      live,
      mockFetch(async () => {
        throw new Error("timeout");
      }),
    ).slack({ text: "test" }),
    (e) => e instanceof ProviderError && e.uncertain,
  );
  await assert.rejects(
    liveProviders(
      live,
      mockFetch(async () => new Response("unexpected")),
    ).slack({ text: "test" }),
    (e) => e instanceof ProviderError && e.uncertain,
  );
});
test("destinations and reconciled URLs are constrained, and target identities reveal no credentials", () => {
  assert.equal(
    validIssueUrl(
      "https://github.com/demo/pos-incidents/issues/42",
      live.githubRepository,
    ),
    true,
  );
  for (const url of [
    "https://github.com/other/repo/issues/42",
    "https://github.com/demo/pos-incidents/issues/42?secret=x",
    "javascript:alert(1)",
    "https://github.com/demo/pos-incidents/issues/abc",
    "https://attacker.example/demo/pos-incidents/issues/42",
  ])
    assert.equal(validIssueUrl(url, live.githubRepository), false);
  assert.throws(() =>
    liveProviders({ ...live, slackWebhookUrl: "http://localhost/internal" }),
  );
  assert.throws(() =>
    liveProviders({ ...live, githubRepository: "invalid/repo/path" }),
  );
  assert.ok(!providerTargets(live).slack.includes("FAKE"));
  assert.notEqual(
    providerTargets(live).slack,
    providerTargets({ ...live, slackWebhookUrl: live.slackWebhookUrl + "2" })
      .slack,
  );
});
