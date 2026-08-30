# Google Apps Script snapshots

This directory stores read-only, source-controlled snapshots exported through the
official Google Apps Script API `projects.getContent` method.

- `versions/v38` is the source snapshot used by the current production deployment.
- `versions/v39` is a saved numbered version that failed the zero-write safety gate and
  must not be deployed.
- `candidates/v40` is the complete repository candidate derived from `v39`; it is not an
  Apps Script numbered version until a separately approved write-and-version operation.
- Each version contains all 15 Apps Script project files: one manifest and 14
  server-side JavaScript files.

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

`verification.json` records the original and sanitized SHA-256 value of every
numbered-version file and the full source-tree SHA-256 of `candidates/v40`. When
the local exact exports are present, the verifier proves that every repository
file is byte-identical to its export after exactly the two documented URL
replacements above.

Run the verification with:

```bash
node apps-script/scripts/verify-snapshots.mjs
```

Importing or merging these files does not change the Apps Script project. The
production deployment remains on `v38`; writing the `v40` candidate to HEAD,
creating its numbered version, or changing the deployment requires a separate
approved operation.
