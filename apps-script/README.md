# Google Apps Script snapshots

This directory stores read-only, source-controlled snapshots exported through the
official Google Apps Script API `projects.getContent` method.

- `versions/v38` is the previous production snapshot.
- `versions/v39` is a historical saved numbered version that failed the zero-write
  safety gate and was never deployed.
- `versions/v40` is the sanitized snapshot of the numbered version used by the current
  production deployment.
- `candidates/v40` is retained as the reviewed release candidate and must remain
  byte-identical to `versions/v40` until it is deliberately retired.
- `candidates/v41` is an undeployed full-source candidate for the read-only client
  portal. It adds one server file and changes only the MiniApp request router relative
  to production `v40`.
- `candidates/v43` is the same read-only client portal source plus a public,
  non-sensitive runtime identity probe. The probe fingerprints the exact client router
  and portal module bytes so the serving web-app runtime can be checked after a
  deployment update.
- Numbered versions through `v40` contain 15 Apps Script project files. Candidates
  `v41` and `v43` contain 16 files because they add the isolated client portal server
  module.

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

`verification.json` records the original and sanitized SHA-256 values for the retained
exact exports, the verified source-tree SHA-256 of `v40`, and the required identity
between `versions/v40` and `candidates/v40`. The numbered `v40` source was compared with
the candidate through the official API during its release and matched after exactly the
two documented URL replacements above. When a retained local exact export is present,
the verifier also repeats the per-file export comparison.

Run the verification with:

```bash
node apps-script/scripts/verify-snapshots.mjs
```

After an Apps Script deployment update, request the active web-app URL with
`?dms_runtime_identity=1&probe=<unique value>` and compare all returned marker fields
with `candidates/v43/TelegramBot.gs`. A deployment is not accepted solely from its
version metadata: the live marker must match and `clientPortalHandlerLoaded` must be
`true` before any authenticated smoke.

The repeatable live check is:

```bash
DMS_APPS_SCRIPT_URL=<active-web-app-url> npm run smoke:apps-script-runtime
```

The script never prints the configured URL.

Importing or merging these files does not change the Apps Script project. Production is
on numbered `v40`; any future HEAD, version, or deployment write remains a separately
approved operation.
