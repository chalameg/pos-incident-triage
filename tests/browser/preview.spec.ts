import { test, expect } from "@playwright/test";

test("full preview flow: replay, inspect, approve, reload, and preserve history in fresh run", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Incident inbox" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "+ Start fresh run" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "+ Start fresh run" }).click();
  await expect(page.getByRole("status")).toContainText("Fresh run started.");
  await expect(
    page.getByRole("heading", { name: "Ready for the first signal" }),
  ).toBeVisible();
  const runId = await page.getByLabel("Demo run").inputValue();
  await page.getByRole("button", { name: "Replay multi-store burst" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "7 events received · 6 new · 1 duplicates ignored",
  );
  const detail = page.getByRole("region", { name: "Incident detail" });
  await expect(
    detail.getByRole("heading", {
      name: "Payment authorization timeouts across 2 stores",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    detail.getByText("Rule-based summary", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByText("6 attempts / 2 stores", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve escalation", exact: true }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Evidence 6" }).click();
  await expect(detail.locator(".timeline > li")).toHaveCount(6);
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await detail.getByText("View full issue body", { exact: true }).click();
  await expect(detail.locator(".payload-preview pre")).toContainText(
    "Distinct failed checkout attempts: 6",
  );
  await page
    .getByLabel("I reviewed the evidence and both escalation payloads.")
    .check();
  await page
    .getByRole("button", { name: "Approve escalation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview escalation completed" }),
  ).toBeVisible();
  await expect(
    detail.getByText("Simulated success", { exact: true }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Replay multi-store burst" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "7 events received · 0 new · 7 duplicates ignored",
  );
  await expect(
    detail.getByText("Escalation history (2)", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByLabel("Demo run").selectOption(runId);
  await page
    .getByRole("button", {
      name: /High priority.*Payment authorization timeouts/,
    })
    .click();
  await expect(
    detail.getByText("Simulated success", { exact: true }),
  ).toHaveCount(2);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-preview.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Replay isolated failures" }).click();
  await expect(detail.getByText("Low priority", { exact: true })).toBeVisible();
  await expect(
    detail.getByText("2 attempts / 1 stores", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ Start fresh run" }).click();
  await expect(
    page.getByRole("heading", { name: "Ready for the first signal" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ready for the first signal" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Every incident starts with evidence." }),
  ).toBeVisible();
  await page.getByLabel("Demo run").selectOption(runId);
  await expect(page.locator(".incident-card")).toHaveCount(2);
  await page
    .getByRole("button", {
      name: /High priority.*Payment authorization timeouts/,
    })
    .click();
  await expect(
    detail.getByText("Simulated success", { exact: true }),
  ).toHaveCount(2);
  expect(browserErrors).toEqual([]);
});

test("mutations reject cross-origin requests and require explicit approval", async ({
  request,
}) => {
  const rejected = await request.post("/api/runs", {
    headers: { origin: "https://untrusted.example" },
    data: {},
  });
  expect(rejected.status()).toBe(400);
  const created = await request.post("/api/runs", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: {},
  });
  expect(created.status()).toBe(200);
  const run = (await created.json()).run;
  const replay = await request.post("/api/replay", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { runId: run.id, scenario: "burst" },
  });
  const id = (await replay.json()).replay.incidentIds[0];
  const unapproved = await request.post(`/api/incidents/${id}/approve`, {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { approved: false },
  });
  expect(unapproved.status()).toBe(409);
  const dashboard = await request.get("/api/incidents");
  expect(
    (await dashboard.json()).incidents.find((i: { id: string }) => i.id === id)
      .history,
  ).toEqual([]);
});

test("stale review is rejected; valid repeated approval returns the same recorded results", async ({
  request,
}) => {
  const headers = { origin: "http://127.0.0.1:3100" };
  const create = await request.post("/api/runs", { headers, data: {} });
  const run = (await create.json()).run;
  const replay = await request.post("/api/replay", {
    headers,
    data: { runId: run.id, scenario: "burst" },
  });
  const data = await replay.json();
  const id = data.replay.incidentIds[0];
  const incident = data.incidents.find((i: { id: string }) => i.id === id);
  const stale = await request.post(`/api/incidents/${id}/approve`, {
    headers,
    data: { approved: true, reviewToken: "0".repeat(64) },
  });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error).toContain("changed");
  const approval = { approved: true, reviewToken: incident.reviewToken };
  const first = await request.post(`/api/incidents/${id}/approve`, {
    headers,
    data: approval,
  });
  expect(first.status()).toBe(200);
  const again = await request.post(`/api/incidents/${id}/approve`, {
    headers,
    data: approval,
  });
  expect(again.status()).toBe(200);
  const result = (await again.json()).incidents.find(
    (i: { id: string }) => i.id === id,
  );
  expect(result.history).toHaveLength(2);
  expect(result.actions.map((a: { state: string }) => a.state)).toEqual([
    "succeeded",
    "succeeded",
  ]);
});
