# Recording outline (6–8 minutes)

## Before recording

- Use Node 24 and run `npm ci`, `npm run build`, then `npm start`.
- Open http://127.0.0.1:3000 and choose **Start fresh run**. Do not delete the database; old runs demonstrate durability.
- Keep `ESCALATION_MODE=preview` for a credential-free recording. Both provider results must be described as simulated.
- If showing Gemini, configure `GEMINI_API_KEY` and `GEMINI_MODEL` in `.env.local`, restart, then use a fresh run. Verify the UI says **Gemini draft**; otherwise explain the visible fallback reason.
- If showing live escalation, obtain explicit authorization before any real test, use a dedicated demo repository/channel, configure their secrets, and verify permissions and actual delivery. Do not display `.env.local`, tokens, or webhook URLs.
- Keep README, solution design, frontend/backend source, and test results available. The recording itself still needs to be made.

## 0:00–0:45 — Problem

Explain the restaurant checkout support problem: isolated device issues versus cross-store bursts, duplicate event noise, and the need for evidence before escalation. All data and stores are fictional.

## 0:45–1:45 — Design decisions

Show the solution diagram. Explain deterministic grouping/priority, five-minute fixed windows, SQLite persistence, bounded AI drafting, and human approval. Point out that a timeout does not prove a failed payment or root cause.

## 1:45–3:30 — End-to-end preview

1. Replay isolated failures: one low-priority incident, two attempts, one store.
2. Replay the multi-store burst: one high-priority incident, six attempts, two stores.
3. Point to the message **7 received / 6 new / 1 duplicate ignored**.
4. Open Evidence and show timestamps, store IDs, attempt IDs, normalized signature and priority rationale.
5. Review the summary source, unknowns and suggested first check.
6. Open the full GitHub issue body; read the Slack preview and its issue-link placeholder.
7. Acknowledge review and approve. Show the two separate simulated-success results and history entries.
8. Replay the burst: counts and history do not inflate.

## 3:30–4:30 — Durability

Restart the server, refresh, and show the saved incident and escalation history. Start a new run, then select the older run to show that nothing was deleted.

## 4:30–6:00 — Frontend and backend code

- `app/dashboard.tsx`: run controls, evidence and approval UI.
- `lib/triage.ts`: normalization, fixed windows, distinct attempts and rule evaluation.
- `lib/store.ts`: SQLite uniqueness constraints, atomic claims and persisted issue URL.
- `lib/gemini.ts`: structured output and validation/fallback; backend priority remains authoritative.
- `lib/escalation.ts` and `lib/providers.ts`: GitHub before Slack, partial retries, no automatic resend after uncertain delivery.

## 6:00–7:00 — Tests and failure paths

Show passing checks. Explain the mocked Slack failure test: GitHub stays succeeded, and retry sends Slack only. Explain unknown-outcome reconciliation and concurrent-click protection. Show the mobile dashboard or the browser-test screenshot.

## 7:00–8:00 — Honest limits and handoff

State which integrations were actually exercised: preview and mocked adapters are verified; live services require separate credentials and authorization. Call out constrained AI phrasing and fixed windows as demo choices. Cloud deployment and Cloud Scheduler are outside this one-day MVP. Hand over the source, README, solution design and recording.
