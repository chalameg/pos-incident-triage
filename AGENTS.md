# Project instructions

Propose or summarize an implementation plan first and wait for approval. Once approved, proceed with normal edits, supporting files, tests, lint, builds, and related fixes within that scope.

Ask before destructive actions, dependency changes, database migrations/schema changes, deployment changes, secrets/env/config changes, public API contract changes, or changes outside the approved scope. The initial MVP dependencies, SQLite schema, and local configuration are approved in the current task.

Do not report whether a file is tracked or untracked as a review finding.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
