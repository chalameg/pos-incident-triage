# POS Incident Triage

A local full-stack MVP for the Brain3 AI Automation Assignment. Synthetic checkout failures become evidence-backed incidents, a validated triage draft, and human-approved GitHub/Slack escalations.

## Run locally

Requires **Node.js 24.x** and npm. Node's built-in `node:sqlite` avoids a native database install; this Node release still prints an experimental SQLite warning.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open **http://127.0.0.1:3000**. No API credentials are required. For the production build:

```bash
npm run build
npm start
```

Both servers bind to loopback. Stop the development server before starting browser tests; Next allows one development server per checkout.

## Try the complete preview demo

1. Click **Replay multi-store burst**. A run is created automatically if needed.
2. Review the high-priority incident: **6 failed attempts, 2 stores, 6 evidence events**. The 7th transmitted event is a duplicate.
3. Open **Evidence**, review the priority rationale and clearly labeled **Rule-based summary**, then inspect both escalation payloads.
4. Check the review acknowledgment and click **Approve escalation**. GitHub succeeds first, then Slack; both are explicitly **simulated**.
5. Replay the burst again: **0 new events**, unchanged counts, and no duplicate escalation records.
6. Replay isolated failures for a **low-priority incident: 2 attempts, 1 store**.
7. Restart the app and refresh. Incidents and escalation history remain. **Start fresh run** creates another run without deleting anything; the run selector restores older runs.

SQLite is created automatically at **`data/triage.sqlite`**. The database, WAL files, `.env.local`, and test artifacts are gitignored. Keep the `data/` directory when restarting or moving this local demo. The app does not use an in-memory database in normal operation.

## Configuration

Next.js loads `.env.local` into the **server** environment. No credentials use `NEXT_PUBLIC_`, and the browser never receives secrets. `.env.example` contains empty credential placeholders and safe defaults only. Restart the server after changing configuration. Shell environment variables take precedence over `.env.local`.

| Variable               | Default / purpose                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`       | Empty: deterministic fallback; set a Gemini API key to enable drafting                         |
| `GEMINI_MODEL`         | Empty: fallback; set an available model ID supporting `generateContent` structured JSON output |
| `ESCALATION_MODE`      | `preview`; explicitly set `live` for real GitHub/Slack actions                                 |
| `GITHUB_TOKEN`         | Empty; token with **Issues: write** on the dedicated demo repository                           |
| `GITHUB_REPOSITORY`    | Empty; `owner/repository` for a dedicated synthetic demo repository                            |
| `SLACK_WEBHOOK_URL`    | Empty; Slack incoming webhook for a dedicated demo channel                                     |
| `SLACK_CHANNEL_LABEL`  | Empty; human-readable label for the actual webhook channel, e.g. `#pos-demo`                   |
| `SQLITE_PATH`          | `data/triage.sqlite`, relative to the project root unless absolute                             |
| `TRIAGE_HIGH_ATTEMPTS` | `5`; positive integer, captured when a run is created                                          |
| `TRIAGE_HIGH_STORES`   | `2`; positive integer, captured when a run is created                                          |

**Gemini:** on the first replay of each scenario, the server sends synthetic facts and evidence and validates the structured response. Missing configuration, API errors, incomplete responses, invented evidence, changed counts, and unsupported prose all produce a labeled rule-based fallback. Gemini uses bounded fact-derived wording and approved troubleshooting choices; it cannot choose priority or trigger actions. A saved draft stays stable on replay. After configuring Gemini, start a fresh run to exercise it. Gemini can be enabled while GitHub/Slack remain in preview mode.

**Live escalation:** configure both providers, set `ESCALATION_MODE=live`, restart, and review the displayed destinations. The live adapters use GitHub REST issue creation and Slack incoming webhooks. Only an explicit UI approval sends requests. A Slack webhook's actual channel is configured in Slack; the label is descriptive and does not route messages. Real provider tests require separate explicit authorization; none are part of automated verification.

If Slack fails, the saved issue URL stays visible, and the next approval retries only Slack. Network errors, timeouts, 5xx responses, malformed successes, or interrupted processes are treated as **outcome unknown**. Check the repository/channel for the incident ID, then record either **already delivered** (provide the existing GitHub URL when applicable) or **nothing was delivered**. Only the latter enables a new send on the next approval. Abandoned actions become unknown after 60 seconds. Changing a destination after its first attempt is blocked; restore it or use a new demo run.

## Rules and architecture

- Group by **run ID + checkout stage + normalized error code + fixed five-minute UTC window**. Windows are half-open `[start, end)`, aligned to UTC clock boundaries; this is a demo assumption rather than a sliding window.
- Deduplicate event IDs within a run. Count distinct `(store ID, checkout attempt ID)` pairs; attempt IDs are scoped to their store.
- High priority requires **at least 5 distinct failed attempts across at least 2 stores** in that window. Everything else is low. Threshold changes apply only to new runs.
- Fictional stores: **Juniper Kitchen** and **Copper Table**. Fixtures contain no customer, payment, or real store data. Receipt errors do not imply failed payment; payment timeouts leave payment outcome unknown.
- Next.js App Router + TypeScript; browser dashboard → same-origin Node.js route handlers → SQLite. Pure grouping logic is separate from storage, AI drafting, and provider adapters.
- SQLite transactions claim each action before network I/O. GitHub's URL is committed before Slack. Preview/live action records are separate; every attempt stores its payload and outcome. A review fingerprint rejects approval when the draft, mode, or destination has changed.

See [solution design](docs/SOLUTION_DESIGN.md) and the [recording outline](docs/RECORDING_OUTLINE.md).

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:restart
```

`test:restart` requires a completed production build and free port 3111. It creates a synthetic demo run in the default `data/triage.sqlite`, approves it in preview, restarts the real server, and verifies persisted evidence/history and idempotency. It leaves that run available for review.

Unit/integration tests use temporary SQLite databases and injected mock providers. Browser tests force empty Gemini credentials and preview mode, use a separate `/tmp/pos-triage-browser.sqlite` database, and run at **1440×1000** and **390×844**. They expect Chrome at `/usr/bin/google-chrome`; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to another installed Chrome/Chromium executable if needed. Screenshots/traces go to gitignored `test-results/`.

Live Gemini output, real GitHub permissions/issue creation, and actual Slack delivery must still be verified with your own configured destinations. The recording is a separate deliverable; the outline is supplied.

## MVP limits

Local, single-operator demo; no authentication, ingestion from a real POS, pagination, incident closure, or sliding-window correlation. Gemini uses constrained wording to make grounding mechanically verifiable. Cloud deployment, Cloud Scheduler, and scheduled rechecks are outside scope. This is not a public hosted service.
