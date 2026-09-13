// Run existing accepted-semantics fixtures against the undeployed v57 candidate.
// Historical baseline/reproduction tests remain on their original sources.
import {spawnSync} from 'node:child_process';
const result = spawnSync(process.execPath, ['--test',
  'tests/apps-script-business-semantics.test.mjs',
  'tests/apps-script-emergency-recovery.test.mjs',
  'tests/apps-script-domain-day-confirmation.test.mjs',
  'tests/apps-script-telegram-row-action-ux.test.mjs',
], {stdio: 'inherit', env: {...process.env, DMS_AUDIT_BUNDLE: '1'}});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
