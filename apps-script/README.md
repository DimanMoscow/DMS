# Google Apps Script snapshots

This directory stores read-only, source-controlled snapshots exported through the
official Google Apps Script API `projects.getContent` method.

- `versions/v38` is the previous production snapshot.
- `versions/v39` is a historical saved numbered version that failed the zero-write
  safety gate and was never deployed.
- `versions/v40` is the sanitized snapshot of the last production version before the
  client portal rollout.
- Numbered `v41` is a damaged historical release artifact. It was never deployed and
  has no repository snapshot.
- `versions/v42` preserves the sanitized numbered source whose deployment metadata was
  correct but whose serving runtime reproducibly executed an older action router.
- `versions/v43` is the previous production snapshot. It contains the read-only client
  portal plus a public runtime identity probe.
- `versions/v44` is the previous production snapshot. It adds one-time, hashed client
  enrollment and append-only trainer measurement writes.
- `candidates/v40` is retained as the reviewed release candidate and must remain
  byte-identical to `versions/v40` until it is deliberately retired.
- `candidates/v41` is retained as the reviewed source of numbered `v42`. It adds one
  server file and changes only the MiniApp request router relative to `v40`.
- `candidates/v43` is the same read-only client portal source plus a public,
  non-sensitive runtime identity probe. The probe fingerprints the exact client router
  and portal module bytes so the serving web-app runtime can be checked after a
  deployment update.
- `candidates/v44` adds one-time client enrollment and trainer-side append-only
  measurements to `v43`. It remains the reviewed source for numbered `v44`.
- `candidates/v45` adds the payloadless MiniApp entry resolver to `v44`. It remains the
  reviewed source for numbered `v45`.
- `candidates/v46` keeps the `v45` routing behavior and adds a server-side no-op
  correction guard for append-only measurements. It has no runtime effect until a
  separately verified numbered deployment.
- Numbered versions through `v40` contain 15 Apps Script project files. Versions `v42`
  through `v45` contain 16 files because they include the isolated client portal
  server module.

## Deliberate sanitization

The exact exports contain two production URLs. The repository copies make only
these two deliberate replacements:

```text
TelegramBot.gs                  -> __DMS_APPS_SCRIPT_PRODUCTION_URL__
ZZZZZZZZZMiniAppTelegram.gs     -> __DMS_MINI_APP_PRODUCTION_URL__
```

The corresponding placeholders are:

```text
__DMS_APPS_SCRIPT_PRODUCTION_URL__
__DMS_MINI_APP_PRODUCTION_URL__
```

Both the production Apps Script URL and the production MiniApp URL must be
supplied outside the repository through deployment configuration (for example,
Script Properties or an equivalent configuration layer) before any future
write-back workflow is designed. This repository does not contain either real
URL, a `.clasp.json`, Script Properties, or a configured `clasp push`/deployment
path.

## Exact-export control hashes

The unsanitized JSON responses are retained only in the local, Git-excluded
`apps-script/.local-exports/` directory for byte-for-byte verification. They must
not be committed because they contain the real deployment URL and project ID.

| Version | Exact API export SHA-256 |
| --- | --- |
| `v38` | `86445b8620f0ada671eaddb0fde8523bb9d36162599bb06819c22fa135e5ac3f` |
| `v39` | `4e35dd105cb7aa6f140ce7cbee42ebfa9c59c3eff7f8b2adab41a5edabf15744` |

`verification.json` records original and sanitized SHA-256 values for retained exact
exports, source-tree hashes, changed-file sets, and required candidate/snapshot
identities. The verifier proves `v42 == candidates/v41`, `v43 == candidates/v43`,
and `v44 == candidates/v44`
after exactly the two documented URL replacements above. When a retained local exact
export is present, it also repeats the per-file export comparison.

Run the verification with:

```bash
node apps-script/scripts/verify-snapshots.mjs
```

After an Apps Script deployment update, request the active web-app URL with
`?dms_runtime_identity=1&probe=<unique value>` and compare all returned marker fields
with the active candidate's `TelegramBot.gs`. A deployment is not accepted solely from its
version metadata: the live marker must match and `clientPortalHandlerLoaded` must be
`true` before any authenticated smoke.

The repeatable live check is:

```bash
DMS_APPS_SCRIPT_URL=<active-web-app-url> npm run smoke:apps-script-runtime
```

The script never prints the configured URL.

Importing or merging these files does not change the Apps Script project. Production is
on numbered `v45`, whose reviewed source remains in `candidates/v45`; any future HEAD,
version, or deployment write remains a separately approved operation.
