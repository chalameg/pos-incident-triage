"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  payloads,
  STORES,
  type DashboardData,
  type IncidentView,
  type Provider,
  type Scenario,
} from "@/lib/domain";

const clock = (time: string) =>
  new Date(time).toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const date = (time: string) =>
  new Date(time).toLocaleString("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  });
function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
const status = (i: IncidentView) =>
  i.actions.every((a) => a.state === "succeeded")
    ? "Escalated"
    : i.actions.some((a) => a.state === "unknown")
      ? "Check destination"
      : i.actions.some((a) => a.state === "failed")
        ? "Retry needed"
        : i.actions.some((a) => a.state === "running")
          ? "In progress"
          : i.actions.some((a) => a.state === "succeeded")
            ? "Partly escalated"
            : "Needs review";

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [runId, setRunId] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"overview" | "evidence">("overview");
  const [checked, setChecked] = useState(false);
  const [resolutionUrl, setResolutionUrl] = useState("");
  const load = useCallback(
    () =>
      fetch("/api/incidents")
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          return result as DashboardData;
        })
        .then((result) => {
          setData(result);
          setError("");
          setRunId((current) => current || result.runs[0]?.id || "");
          setSelected(
            (current) =>
              current ||
              result.incidents.find((i) => i.runId === result.runs[0]?.id)
                ?.id ||
              "",
          );
        })
        .catch((e) => {
          setError(
            e instanceof Error ? e.message : "Could not load incidents.",
          );
        }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (
      !data?.incidents.some((i) => i.actions.some((a) => a.state === "running"))
    )
      return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [data, load]);
  async function post(url: string, body: object) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The operation failed.");
    setData(result);
    return result;
  }
  async function act(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      await load();
      setChecked(false);
      setError(e instanceof Error ? e.message : "The operation failed.");
    } finally {
      setBusy("");
    }
  }
  function choose(id: string) {
    setSelected(id);
    setChecked(false);
    setResolutionUrl("");
    setTab("overview");
  }
  async function replay(scenario: Scenario) {
    await act(scenario, async () => {
      let active = runId;
      if (!active) {
        const result = await post("/api/runs", {});
        active = result.run.id;
        setRunId(active);
      }
      const result = await post("/api/replay", { runId: active, scenario });
      choose(result.replay.incidentIds[0]);
      setNotice(
        `${result.replay.received} events received · ${result.replay.inserted} new · ${result.replay.duplicates} duplicates ignored`,
      );
    });
  }
  const incident = data?.incidents.find(
    (i) => i.id === selected && i.runId === runId,
  );
  const runIncidents = data?.incidents.filter((i) => i.runId === runId) ?? [];
  const currentRun = data?.runs.find((r) => r.id === runId);
  const preview = data?.mode !== "live";
  const issue = incident?.actions.find((a) => a.provider === "github");
  const generated = incident
    ? payloads(incident, issue?.url ?? undefined)
    : null;
  const completed = incident?.actions.every((a) => a.state === "succeeded");
  const blocked = incident?.actions.some((a) =>
    ["unknown", "running"].includes(a.state),
  );
  async function resolve(
    provider: Provider,
    resolution: "delivered" | "absent",
  ) {
    await act("resolve", async () => {
      await post(`/api/incidents/${selected}/resolve`, {
        provider,
        resolution,
        checkedDestination: true,
        ...(provider === "github" && resolution === "delivered"
          ? { issueUrl: resolutionUrl }
          : {}),
      });
      setNotice("Destination check recorded.");
      setChecked(false);
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="POS Incident Triage home">
          <span className="brand-mark">
            P<span>·</span>
          </span>
          <span>
            POS<span className="brand-sub">INCIDENT TRIAGE</span>
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-icon">B3</span>
          <div>
            Brain3 demo<span>Restaurant operations</span>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <a className="nav-item active" href="#incidents">
          <span aria-hidden="true">▤</span> Incident inbox{" "}
          <b>{data?.incidents.length ?? 0}</b>
        </a>
        <a className="nav-item" href="#demo">
          <span aria-hidden="true">▷</span> Scenario replay
        </a>
        <a className="nav-item" href="#workflow">
          <span aria-hidden="true">◎</span> How triage works
        </a>
        <div className="sidebar-bottom">
          <span className="connection-dot" /> Local workspace
          <p>
            Evidence and escalation history
            <br />
            persist across app restarts.
          </p>
          <span className="avatar">OP</span>
          <span>
            Demo operator<small>Human approval required</small>
          </span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            Workspace <span>/</span> <strong>Incident inbox</strong>
          </div>
          <div className="topbar-right">
            <span className="synthetic">Synthetic data</span>
            <Badge tone={preview ? "preview" : "high"}>
              {preview ? "Preview mode" : "Live mode"}
            </Badge>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CHECKOUT RELIABILITY</p>
              <h1>Incident inbox</h1>
              <p>From checkout failure to a clear next step.</p>
            </div>
            <button
              className="button secondary"
              onClick={() => void load()}
              disabled={!!busy}
            >
              Refresh inbox
            </button>
          </div>
          <div className={`mode-banner ${preview ? "" : "live"}`}>
            <span className="banner-icon" aria-hidden="true">
              {preview ? "◈" : "!"}
            </span>
            <div>
              <strong>
                {preview
                  ? "A safe place to investigate."
                  : "Live escalation is enabled."}
              </strong>{" "}
              {preview
                ? "GitHub issues and Slack alerts are simulated. No credentials needed."
                : "Approvals send to the configured demo repository and Slack channel."}
            </div>
          </div>
          {error && (
            <div role="alert" className="alert error">
              {error}
              <button onClick={() => void load()}>Reload</button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              {notice}
            </div>
          )}
          <section
            className="demo-panel"
            id="demo"
            aria-labelledby="demo-title"
          >
            <div>
              <div className="section-kicker">DEMO CONTROLS</div>
              <h2 id="demo-title">Replay a checkout scenario</h2>
              <p>
                Inject synthetic events and watch the evidence become an
                incident.
              </p>
            </div>
            <div className="demo-actions">
              <button
                className="button secondary"
                disabled={!!busy || !data}
                onClick={() => void replay("isolated")}
              >
                {busy === "isolated"
                  ? "Replaying…"
                  : "Replay isolated failures"}
                <small>1 store · low priority</small>
              </button>
              <button
                className="button primary"
                disabled={!!busy || !data}
                onClick={() => void replay("burst")}
              >
                {busy === "burst" ? "Replaying…" : "Replay multi-store burst"}
                <small>2 stores · high priority</small>
              </button>
            </div>
          </section>
          <div className="run-controls">
            <label>
              Demo run{" "}
              <select
                aria-label="Demo run"
                value={runId}
                onChange={(e) => {
                  setRunId(e.target.value);
                  choose(
                    data?.incidents.find((i) => i.runId === e.target.value)
                      ?.id || "",
                  );
                }}
              >
                {!data?.runs.length && (
                  <option value="">Created on first replay</option>
                )}
                {data?.runs.map((r, index) => (
                  <option key={r.id} value={r.id}>
                    {date(r.createdAt)} · {r.id.slice(0, 6)}
                    {index === 0 ? " (latest)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="text-button"
              disabled={!!busy || !data}
              onClick={() =>
                void act("new-run", async () => {
                  const result = await post("/api/runs", {});
                  setRunId(result.run.id);
                  choose("");
                  setNotice(
                    "Fresh run started. Earlier incidents and escalation history are preserved.",
                  );
                })
              }
            >
              + Start fresh run
            </button>
          </div>
          <section className="stats" aria-label="Run statistics">
            <div>
              <span>Incidents in this run</span>
              <strong>{runIncidents.length.toString().padStart(2, "0")}</strong>
              <small>Grouped by error signature</small>
            </div>
            <div>
              <span>High priority</span>
              <strong className="red-text">
                {runIncidents
                  .filter((i) => i.priority === "high")
                  .length.toString()
                  .padStart(2, "0")}
              </strong>
              <small>Cross-store impact detected</small>
            </div>
            <div>
              <span>Failed checkout attempts</span>
              <strong>
                {runIncidents
                  .reduce((sum, i) => sum + i.failedAttempts, 0)
                  .toString()
                  .padStart(2, "0")}
              </strong>
              <small>Distinct within each incident</small>
            </div>
            <div>
              <span>Escalations completed</span>
              <strong>
                {runIncidents
                  .filter((i) =>
                    i.actions.every((a) => a.state === "succeeded"),
                  )
                  .length.toString()
                  .padStart(2, "0")}
              </strong>
              <small>
                {preview
                  ? "Simulated, with approval"
                  : "Approved by an operator"}
              </small>
            </div>
          </section>
          <div className="inbox-grid" id="incidents">
            <section
              className="panel incident-list"
              aria-labelledby="list-title"
            >
              <div className="panel-heading">
                <h2 id="list-title">
                  Incidents <span className="count">{runIncidents.length}</span>
                </h2>
                <span className="muted">This run</span>
              </div>
              {!data ? (
                <div className="empty">Loading your workspace…</div>
              ) : !runIncidents.length ? (
                <div className="empty">
                  <span className="empty-symbol">◎</span>
                  <h3>Ready for the first signal</h3>
                  <p>
                    Replay a scenario to detect failures, review the evidence,
                    and preview an escalation.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => void replay("burst")}
                    disabled={!!busy}
                  >
                    Try the multi-store burst
                  </button>
                </div>
              ) : (
                <div className="incident-cards">
                  {runIncidents.map((i) => (
                    <button
                      key={i.id}
                      className={`incident-card ${i.id === selected ? "selected" : ""}`}
                      onClick={() => choose(i.id)}
                      aria-pressed={i.id === selected}
                    >
                      <div className="card-top">
                        <Badge tone={i.priority}>
                          {i.priority === "high"
                            ? "High priority"
                            : "Low priority"}
                        </Badge>
                        <time>{clock(i.windowStart).slice(0, 5)} UTC</time>
                      </div>
                      <h3>{i.triage.title}</h3>
                      <p>{i.stores.map((s) => STORES[s]).join(" · ")}</p>
                      <div className="card-metrics">
                        <span>
                          <b>{i.failedAttempts}</b> failed attempts
                        </span>
                        <span>
                          <b>{i.stores.length}</b> stores
                        </span>
                      </div>
                      <div className="card-footer">
                        <span>{i.id.slice(0, 12)}</span>
                        <span>{status(i)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="list-note">
                Duplicate event IDs never inflate incident counts.
              </div>
            </section>
            <section
              className="panel detail-panel"
              aria-label="Incident detail"
            >
              {!incident ? (
                <div className="empty detail-empty">
                  <span className="empty-symbol">▤</span>
                  <h2>Every incident starts with evidence.</h2>
                  <p>
                    Select an incident to review its impact, supporting events,
                    and recommended next check.
                  </p>
                  <div className="mini-flow">
                    Detect <span>→</span> Review <span>→</span> Approve
                  </div>
                </div>
              ) : (
                <>
                  <div className="detail-heading">
                    <div className="detail-meta">
                      <span className="mono">{incident.id}</span>
                      <Badge tone={incident.priority}>
                        {incident.priority === "high"
                          ? "High priority"
                          : "Low priority"}
                      </Badge>
                    </div>
                    <h2>{incident.triage.title}</h2>
                    <p>
                      {date(incident.windowStart)} UTC · {incident.signature}
                    </p>
                  </div>
                  <div
                    className="tabs"
                    role="tablist"
                    aria-label="Incident information"
                  >
                    <button
                      role="tab"
                      id="overview-tab"
                      aria-controls="overview-panel"
                      aria-selected={tab === "overview"}
                      onClick={() => setTab("overview")}
                    >
                      Overview
                    </button>
                    <button
                      role="tab"
                      id="evidence-tab"
                      aria-controls="evidence-panel"
                      aria-selected={tab === "evidence"}
                      onClick={() => setTab("evidence")}
                    >
                      Evidence <span>{incident.events.length}</span>
                    </button>
                  </div>
                  {tab === "overview" ? (
                    <div
                      className="detail-body"
                      id="overview-panel"
                      role="tabpanel"
                      aria-labelledby="overview-tab"
                    >
                      <div className="impact-row">
                        <div>
                          <span>Failed attempts</span>
                          <strong>{incident.failedAttempts}</strong>
                        </div>
                        <div>
                          <span>Affected stores</span>
                          <strong>{incident.stores.length}</strong>
                        </div>
                        <div>
                          <span>Detection window</span>
                          <strong>
                            {incident.rules.windowMinutes}
                            <small> min</small>
                          </strong>
                        </div>
                      </div>
                      <div className="rationale">
                        <strong>Why {incident.priority} priority?</strong>
                        <p>
                          High priority requires ≥{incident.rules.highAttempts}{" "}
                          distinct failed attempts across ≥
                          {incident.rules.highStores} stores within{" "}
                          {incident.rules.windowMinutes} minutes. Observed:{" "}
                          <b>
                            {incident.failedAttempts} attempts /{" "}
                            {incident.stores.length} stores
                          </b>
                          .{" "}
                          {incident.priority === "high"
                            ? "Both thresholds met."
                            : "High-priority thresholds not met."}
                        </p>
                        <small>
                          Configurable demo assumption · fixed UTC windows · not
                          a production SLA
                        </small>
                      </div>
                      <section className="summary-card">
                        <div className="section-title">
                          <h3>Triage summary</h3>
                          <Badge
                            tone={
                              incident.triage.source === "gemini"
                                ? "preview"
                                : "neutral"
                            }
                          >
                            {incident.triage.source === "gemini"
                              ? "Gemini draft"
                              : "Rule-based summary"}
                          </Badge>
                        </div>
                        <p>{incident.triage.summary}</p>
                        {incident.triage.reason && (
                          <p className="muted fallback-reason">
                            {incident.triage.reason}
                          </p>
                        )}
                        <div className="next-check">
                          <span className="section-kicker">
                            SUGGESTED FIRST CHECK
                          </span>
                          <p>{incident.triage.suggestedNextCheck}</p>
                        </div>
                        <details>
                          <summary>Evidence references & unknowns</summary>
                          <p className="mono evidence-ids">
                            {incident.triage.evidenceIds.join(", ")}
                          </p>
                          <ul>
                            {incident.triage.unknowns.map((u) => (
                              <li key={u}>{u}</li>
                            ))}
                          </ul>
                        </details>
                      </section>
                      <section className="escalation">
                        <div className="section-title">
                          <div>
                            <h3>Review escalation</h3>
                            <p className="muted">
                              Review both payloads before approving.
                            </p>
                          </div>
                          <Badge tone="preview">
                            {preview ? "Simulated" : "Live destinations"}
                          </Badge>
                        </div>
                        <div className="payload-preview">
                          <div className="payload-heading">
                            <strong>
                              <span className="provider-icon">G</span> GitHub
                              issue
                            </strong>
                            <span>{data?.destinations.github}</span>
                          </div>
                          <h4>{generated?.github.title}</h4>
                          <details>
                            <summary>View full issue body</summary>
                            <pre>{generated?.github.body}</pre>
                          </details>
                        </div>
                        <div className="payload-preview">
                          <div className="payload-heading">
                            <strong>
                              <span className="provider-icon slack-icon">
                                #
                              </span>{" "}
                              Slack alert
                            </strong>
                            <span>{data?.destinations.slack}</span>
                          </div>
                          <p className="slack-preview">
                            {generated?.slack.text}
                          </p>
                        </div>
                        <div className="action-results">
                          {incident.actions.map((a) => (
                            <div className="action-result" key={a.provider}>
                              <div>
                                <strong>
                                  {a.provider === "github"
                                    ? "GitHub issue"
                                    : "Slack alert"}
                                </strong>
                                <Badge
                                  tone={
                                    a.state === "succeeded"
                                      ? "success"
                                      : a.state === "failed" ||
                                          a.state === "unknown"
                                        ? "high"
                                        : "neutral"
                                  }
                                >
                                  {a.state === "succeeded" && preview
                                    ? "Simulated success"
                                    : a.state === "pending"
                                      ? "Awaiting approval"
                                      : a.state}
                                </Badge>
                              </div>
                              {a.url &&
                                (preview ? (
                                  <small className="mono">
                                    Simulated issue: {incident.id}
                                  </small>
                                ) : (
                                  <a
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open GitHub issue
                                  </a>
                                ))}
                              {a.error && (
                                <p className="error-text">{a.error}</p>
                              )}
                              {a.state === "unknown" && (
                                <div className="reconcile">
                                  <p>
                                    Check{" "}
                                    {a.provider === "github"
                                      ? "the repository"
                                      : "the Slack channel"}{" "}
                                    for this incident before recording an
                                    outcome.
                                  </p>
                                  {a.provider === "github" && (
                                    <input
                                      aria-label="Existing GitHub issue URL"
                                      placeholder="https://github.com/owner/repo/issues/123"
                                      value={resolutionUrl}
                                      onChange={(e) =>
                                        setResolutionUrl(e.target.value)
                                      }
                                    />
                                  )}
                                  <button
                                    disabled={
                                      !!busy ||
                                      (a.provider === "github" &&
                                        !resolutionUrl)
                                    }
                                    className="button secondary"
                                    onClick={() =>
                                      void resolve(a.provider, "delivered")
                                    }
                                  >
                                    I checked: already delivered
                                  </button>
                                  <button
                                    disabled={!!busy}
                                    className="text-button"
                                    onClick={() =>
                                      void resolve(a.provider, "absent")
                                    }
                                  >
                                    I checked: nothing was delivered
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        {!completed && (
                          <label className="approval-check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => setChecked(e.target.checked)}
                              disabled={!!busy || blocked}
                            />
                            <span>
                              I reviewed the evidence and both escalation
                              payloads.
                            </span>
                          </label>
                        )}
                        <button
                          className="button primary approve-button"
                          disabled={
                            !!busy ||
                            !checked ||
                            completed ||
                            blocked ||
                            (!preview && !data?.liveReady)
                          }
                          onClick={() =>
                            void act("approve", async () => {
                              await post(
                                `/api/incidents/${incident.id}/approve`,
                                {
                                  approved: true,
                                  reviewToken: incident.reviewToken,
                                },
                              );
                              setChecked(false);
                              setNotice(
                                preview
                                  ? "Preview approval recorded. Review the GitHub and Slack results below."
                                  : "Approval processed. Review each provider result below.",
                              );
                            })
                          }
                        >
                          {busy === "approve"
                            ? "Processing approval…"
                            : completed
                              ? preview
                                ? "Preview escalation completed"
                                : "Escalation completed"
                              : issue?.state === "succeeded"
                                ? "Approve Slack retry"
                                : "Approve escalation"}
                        </button>
                        <p className="approval-note">
                          {preview
                            ? "Preview only. Both actions are simulated and saved locally."
                            : "Creates an issue, then posts its link to Slack. Credentials stay on the server."}
                        </p>
                        {!preview && !data?.liveReady && (
                          <p className="error-text">
                            Configure both live providers before approving.
                          </p>
                        )}
                      </section>
                      <details className="history">
                        <summary>
                          Escalation history ({incident.history.length})
                        </summary>
                        {incident.history.length ? (
                          incident.history.map((h) => (
                            <div key={h.id}>
                              <strong>
                                {h.provider} · {h.status}
                              </strong>
                              <small>
                                {date(h.createdAt)} UTC · {h.mode}
                              </small>
                              {h.note && <p>{h.note}</p>}
                              <details>
                                <summary>Recorded payload</summary>
                                <pre>{h.payload}</pre>
                              </details>
                            </div>
                          ))
                        ) : (
                          <p>
                            No external or simulated actions have been approved.
                          </p>
                        )}
                      </details>
                    </div>
                  ) : (
                    <div
                      className="detail-body"
                      id="evidence-panel"
                      role="tabpanel"
                      aria-labelledby="evidence-tab"
                    >
                      <h3>Event timeline</h3>
                      <p className="muted">
                        {clock(incident.windowStart)}–
                        {clock(incident.windowEnd)} UTC · end exclusive ·
                        duplicates removed
                      </p>
                      <ol className="timeline">
                        {incident.events.map((e) => (
                          <li key={e.eventId}>
                            <time>{clock(e.timestamp)}</time>
                            <div>
                              <strong>{STORES[e.storeId]}</strong>
                              <p>{e.message}</p>
                              <div className="event-meta">
                                <code>{e.eventId}</code>
                                <code>{e.attemptId}</code>
                                <code>{e.storeId}</code>
                                <code>{e.stage}</code>
                                <code>{e.errorCode.trim()}</code>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
          <section className="workflow" id="workflow">
            <div>
              <span className="section-kicker">THE WORKFLOW</span>
              <h2>Evidence first. Human approved.</h2>
            </div>
            <p>
              Replay events <span>→</span> Group failures <span>→</span> Assess
              impact <span>→</span> Draft triage <span>→</span> Review & approve{" "}
              <span>→</span> GitHub + Slack
            </p>
          </section>
          <footer>
            <span>POS Incident Triage · Brain3 AI Automation Assignment</span>
            <span>
              {currentRun
                ? `Run ${currentRun.id.slice(0, 8)} · SQLite persistence`
                : "Local-first demo · SQLite persistence"}
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
