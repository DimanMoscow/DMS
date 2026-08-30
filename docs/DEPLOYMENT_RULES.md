# Deployment rules

## MiniApp

1. Start from current `origin/main` and work in a scoped branch.
2. Run targeted tests while editing; run `npm run check` before a release candidate.
3. Review the complete PR diff and merge only with explicit approval.
4. Treat Vercel preview, production deployment, promotion, and rollback as separate
   operations requiring explicit approval. The project is not currently Git-linked.
5. After an approved production change, verify deployment state, `/api/health`, Telegram
   launch, authorized reads, and only the specifically approved mutations.

## Apps Script

- Git stores sanitized numbered snapshots. Apps Script HEAD and deployments remain live
  external state and must be checked before work.
- `clasp push`, Apps Script API `updateContent`, editor saves to HEAD, numbered-version
  creation, and deployment updates are write operations.
- Prepare and review changes in Git first. Verify the complete 15-file set and run:

  ```bash
  node apps-script/scripts/verify-snapshots.mjs
  ```

- Creating a numbered version does not publish it. Updating the production deployment is
  a separate explicitly approved operation.
- Never update the production deployment during diagnosis, export, or snapshot work.

## Production gate

The order is: targeted tests → full local gate → read-only state verification → approved
deployment → final smoke. For day-confirmation logic, validate the dry-run result before
allowing any mutation. Production-data smoke actions must be individually approved.

## Configuration and secrets

- Keep tokens, Script Properties, real Apps Script/MiniApp URLs, project IDs, calendar
  IDs, spreadsheet IDs, and client data outside Git unless a specific non-secret ID has
  been explicitly approved.
- MiniApp server configuration belongs in Vercel environment variables; never expose it
  through `NEXT_PUBLIC_*`.
- Apps Script runtime configuration belongs in Script Properties or another approved
  external configuration layer.
- Repository snapshots use documented placeholders. Never replace them with production
  values in a commit.

Current deviations from these rules are listed in `docs/PROJECT_STATE.md`; do not hide or
silently normalize them during unrelated work.
