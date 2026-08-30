# Repository instructions

## Source of truth

- Start from the current `origin/main`; never infer state from chat history.
- Treat code in Git as the source of truth for the MiniApp and repository snapshots.
- Recheck live Vercel and Apps Script deployment state before release work.
- Read `docs/PROJECT_STATE.md` first, then the relevant architecture or deployment document.

## Layout

- MiniApp: `app/`, `lib/`, `public/`, `tests/`.
- Apps Script snapshots: `apps-script/versions/v38` and `apps-script/versions/v39`.
- Snapshot integrity: `apps-script/verification.json` and
  `apps-script/scripts/verify-snapshots.mjs`.

## Working rules

- Branch from the latest `origin/main`; keep one scoped change per branch and use a PR.
- Do not commit secrets, real operational URLs, `.env` files, Script Properties, or IDs
  that are not explicitly approved for source control.
- Preserve unrelated user changes and stop on unexpected diffs.
- Update `docs/PROJECT_STATE.md` whenever a verified production or release fact changes.

## Checks

- Documentation-only change: `git diff --check` and inspect the complete file list.
- Apps Script snapshot or verifier change:
  `node apps-script/scripts/verify-snapshots.mjs`.
- Isolated MiniApp change: run the relevant test plus lint/type/build checks affected by it.
- Cross-boundary, authentication, queue, day-confirmation, release, or deployment change:
  run `npm run check`, the Apps Script verifier, and the full authorized smoke gate.

Narrow tests are enough only when the changed files cannot affect runtime behavior. A
full smoke is required when a request can cross MiniApp → Apps Script, mutate queue or
calendar state, change authentication, or alter a production release.

## Requires separate approval

- Merge to `main`.
- Any Vercel deployment, promotion, rollback, or production configuration change.
- `clasp push`, Apps Script `updateContent`, HEAD changes, numbered-version creation,
  or deployment changes.
- Writes to production Sheets, Calendar, Telegram, Script Properties, or client data.

See `docs/ARCHITECTURE.md` for boundaries and `docs/DEPLOYMENT_RULES.md` for release
procedure; do not duplicate those details here.
