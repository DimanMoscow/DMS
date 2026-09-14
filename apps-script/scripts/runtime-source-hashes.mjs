import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readCanonicalSource, sha256, sourceTreeSha256} from './source-integrity.mjs';

export const P1_RUNTIME_MODULES = [
  'ZZZZZZZZZZZZTelegramConfirmations.gs',
  'ZZZZZZZZZZZZZOperationSafety.gs',
  'ZZZZZZZZZZZZZZUndoSafety.gs',
  'ZZZZZZZZZZZZZZZFinancialSafety.gs',
  'ZZZZZZZZZZZZZZZZReleaseSafety.gs',
];

export function runtimeSourceRelease(directory) {
  const source = readCanonicalSource(path.join(directory, 'TelegramBot.gs'));
  const matches = [...source.matchAll(/\bRELEASE:\s*'([a-z0-9-]+)'/g)];
  assert.equal(matches.length, 1, 'exactly one source-pinned runtime release required');
  return matches[0][1];
}

export function runtimeSourceHashes(directory) {
  const p1 = fs.existsSync(path.join(directory, P1_RUNTIME_MODULES[1]));
  return {
    routerSha256: sha256(readCanonicalSource(path.join(directory, 'ZZZZZZZZMiniAppApi.gs'))),
    clientPortalSha256: sha256(readCanonicalSource(path.join(directory, 'ZZZZZZZZZZZClientPortal.gs'))),
    telegramConfirmationsSha256: p1 ? sourceTreeSha256(directory, P1_RUNTIME_MODULES)
      : sha256(readCanonicalSource(path.join(directory, P1_RUNTIME_MODULES[0]))),
  };
}
