import fs from 'node:fs';
import path from 'node:path';
import {readCanonicalSource, sha256, sourceTreeSha256} from './source-integrity.mjs';

export const P1_RUNTIME_MODULES = [
  'ZZZZZZZZZZZZTelegramConfirmations.gs',
  'ZZZZZZZZZZZZZOperationSafety.gs',
  'ZZZZZZZZZZZZZZUndoSafety.gs',
  'ZZZZZZZZZZZZZZZFinancialSafety.gs',
  'ZZZZZZZZZZZZZZZZReleaseSafety.gs',
];

export function runtimeSourceHashes(directory) {
  const p1 = fs.existsSync(path.join(directory, P1_RUNTIME_MODULES[1]));
  return {
    routerSha256: sha256(readCanonicalSource(path.join(directory, 'ZZZZZZZZMiniAppApi.gs'))),
    clientPortalSha256: sha256(readCanonicalSource(path.join(directory, 'ZZZZZZZZZZZClientPortal.gs'))),
    telegramConfirmationsSha256: p1 ? sourceTreeSha256(directory, P1_RUNTIME_MODULES)
      : sha256(readCanonicalSource(path.join(directory, P1_RUNTIME_MODULES[0]))),
  };
}
