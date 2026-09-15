import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {loadBundle} from '../../tests/helpers/apps-script-bundle.mjs';
import {memoryWorkbook} from '../../tests/helpers/memory-workbook.mjs';
import {googleJson, loadAuthorizationProfile, refreshGoogleAccessToken} from './google-auth.mjs';
import {normalizeRemoteFiles, verifyRemoteBaseline, materializeCandidate} from './apps-script-preflight.mjs';
import {readCanonicalSource, sourceTreeSha256} from './source-integrity.mjs';
import {fingerprint, SAFETY_TYPES} from './release-reconciliation.mjs';
import {compileCalendarAcceptance} from './calendar-acceptance-evidence.mjs';
import {assertPrivateRegularFile, isOutsidePath} from '../../scripts/path-policy.mjs';
import {nativeUiChannel} from './native-ui-channel.mjs';
import {collectorSafety} from './collector-safety.mjs';
import {sheetBusinessRevision} from './business-revision.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(root);
const columns = {'Клиенты': 'N', 'Блоки': 'R', 'Оплаты': 'K', 'Журнал тренировок': 'S',
  'Очередь подтверждения': 'Q', 'Настройки': 'D', 'Журнал операций Telegram': 'Q'};
const dateColumns = {'Блоки': [4, 5], 'Оплаты': [1, 8], 'Журнал тренировок': [1, 9, 15, 16],
  'Очередь подтверждения': [1, 5, 6, 14], 'Журнал операций Telegram': [1]};
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const local = version => new Map(fs.readdirSync(path.join(root, 'candidates', version))
  .map(name => [name, readCanonicalSource(path.join(root, 'candidates', version, name))]));

export function decodeRows(valueRanges) {
  return Object.fromEntries(valueRanges.map(entry => {
    const name = entry.range.split('!')[0].replaceAll("'", '');
    return [name, (entry.values || []).map(row => row.map((v, i) => typeof v === 'number' &&
      ((dateColumns[name] || []).includes(i) || name === 'Настройки' &&
      row[0] === 'Начало автоматического учёта' && i === 1)
      ? new Date(Math.round((v - 25569) * 86400000) - 10800000) : v))];
  }));
}

// Both service boundaries are injected. There is no apply transport or invocation
// of syncCalendarToQueue: only the actual immutable bundles' pure planners run.
export async function collectPlans({rows, native, now, readCalendar}) {
  assert.equal(process.env.DMS_AUDIT_BUNDLE, undefined, 'bundle redirect forbidden');
  const cache = new Map(); const receipts = [];
  function FixedDate(...args) { return new Date(...(args.length ? args : [now])); }
  FixedDate.prototype = Date.prototype;
  Object.setPrototypeOf(FixedDate, Date);
  FixedDate.now = () => Date.parse(now);
  async function plan(version, wide = false) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const pending = new Map(); const book = memoryWorkbook(rows);
      const read = (method, id, params) => {
        const key = JSON.stringify({method, id, params});
        if (cache.has(key)) {
          const result = cache.get(key);
          if (result.missing) throw new Error('Not Found');
          return structuredClone(result);
        }
        pending.set(key, {method, id, params}); throw new Error('Read capture pending');
      };
      const f = loadBundle(version, {Date: FixedDate, SpreadsheetApp: book.service,
        Calendar: {Events: {list: (id, p) => read('list', id, p), get: (id, e) => read('get', id, e)}},
        UrlFetchApp: {fetch: () => { throw new Error('Network from bundle forbidden'); }}});
      f.properties.set('DMS_CALENDAR_BOUNDED_SCAN_V1', JSON.stringify({...native.scan,
        ...(wide ? {lastWideVerificationAt: '2000-01-01T00:00:00.000Z'} : {})}));
      let result;
      try { result = f.context.buildCalendarQueueSyncPlan_(null, {now: new FixedDate()}); }
      catch (error) { if (!pending.size) throw error; }
      assert.equal(book.writes.length, 0, 'planner attempted workbook write');
      assert.equal(f.writes.length, 0, 'planner attempted external write');
      if (pending.size) {
        for (const [key, q] of pending) {
          const response = await readCalendar(q);
          assert.ok(response && typeof response === 'object');
          if (q.method === 'list') {
            assert.ok(response.items === undefined || Array.isArray(response.items), 'invalid Calendar page');
            if (response.nextPageToken) {
              assert.equal(typeof response.nextPageToken, 'string');
              const usedTokens = receipts.filter(x => x.request.method === 'list' && x.request.id === q.id &&
                fingerprint({...x.request.params, pageToken: null}) === fingerprint({...q.params, pageToken: null}))
                .map(x => x.request.params.pageToken);
              assert.ok(response.nextPageToken !== q.params.pageToken && !usedTokens.includes(response.nextPageToken),
                'Calendar pagination cycle');
            }
          }
          cache.set(key, response); receipts.push({request: q, response});
        }
        continue;
      }
      assert.ok(result); assert.equal(result.errors, 0, 'planner error');
      return {result, f};
    }
    throw new Error('Calendar pagination/request ceiling exceeded');
  }
  const baseline = await plan('v56'); const candidate = await plan('v57'); const wide = await plan('v56', true);
  const c = candidate.f.context;
  const config = c.getCalendarSyncSettings_(candidate.f.context.SpreadsheetApp.getActive().getSheetByName('Настройки'));
  const window = c.getDmsCalendarWideWindow_(config, new FixedDate());
  const list = receipts.filter(x => x.request.method === 'list');
  assert.ok(list.length > 0);
  for (const page of list) {
    assert.equal(page.request.params.showDeleted, true, 'deleted events not requested');
    if (page.response.nextPageToken) assert.ok(list.some(next =>
      next.request.id === page.request.id && next.request.params.pageToken === page.response.nextPageToken &&
      fingerprint({...next.request.params, pageToken: null}) === fingerprint({...page.request.params, pageToken: null})),
    'pagination incomplete');
  }
  const events = [...new Map(list.filter(x => x.request.params.timeMin)
    .flatMap(x => x.response.items || []).map(e => [e.id, e])).values()];
  const queue = rows['Очередь подтверждения'].slice(3).map((values, i) => ({row: i + 4, values}));
  const journal = rows['Журнал тренировок'].slice(3).map((values, i) => ({row: i + 4, values}));
  const options = {calendarId: list[0].request.id, startDate: window.start, endDate: window.end};
  const before = c.buildDmsCalendarQueueReconciliationReport_(queue, journal, events, options);
  const projected = candidate.result.queueRows.map((values, i) => ({row: i + 4, values}));
  const after = c.buildDmsCalendarQueueReconciliationReport_(projected, journal, events, options);
  const clients = rows['Клиенты'].slice(4), blocks = rows['Блоки'].slice(3), payments = rows['Оплаты'].slice(3);
  const expected = c.computeDmsFinancialExpected_(clients, blocks, payments, journal.map(x => x.values));
  const numeric = [];
  for (const [data, targets] of [[clients, expected.clients], [blocks, expected.blocks]]) {
    for (const [id, values] of Object.entries(targets)) for (const [column, value] of Object.entries(values)) {
      const actual = data.find(row => row[0] === id)?.[Number(column) - 1];
      if (!Number.isFinite(Number(actual)) || Math.abs(Number(actual) - value) > 0.000001)
        numeric.push({id, column, expected: value, actual: actual ?? null});
    }
  }
  const businessFindings = c.computeDmsBusinessSemanticFindings_(clients, blocks, payments,
    journal.map(x => x.values), queue.map(x => x.values));
  return JSON.parse(JSON.stringify({checkedAt: now, scan: native.scan,
    baselineGeneration: native.generation.syncGeneration, calendarId: options.calendarId, window,
    events, queue, journal, baselineWrites: baseline.result.writes, candidateWrites: candidate.result.writes,
    v56WideWrites: wide.result.writes, before, after,
    financial: {issues: expected.issues, numeric, businessFindings},
    plannerCounts: {baseline: baseline.result.errors, candidate: candidate.result.errors,
      added: candidate.result.added, updated: candidate.result.updated, cancelled: candidate.result.cancelled},
    requests: list.map(x => x.request.params), rawCalendar: receipts,
    paginationComplete: true, showDeleted: true, productionMutations: 0}));
}

// Native Script Properties have no REST reader in this default-GCP bound project.
// A fresh supported native-reader adapter must provide this receipt; stale files
// may be replayed for diagnostics but cannot produce an activation package.
export async function collectReleaseEvidence({readNative, readGoogle, readCalendar, target, releaseCommitSha,
  clock = () => new Date().toISOString()}) {
  const native = await readNative(); const now = clock();
  assert.ok(Date.parse(now) - Date.parse(native.checkedAt) >= 0 &&
    Date.parse(now) - Date.parse(native.checkedAt) <= 300000, 'stale native cursor receipt');
  assert.equal(native.ready, 'emergency-semantic-recovery-2026-09');
  assert.equal(native.generation.status, 'succeeded');
  const api = 'https://script.googleapis.com/v1/projects/' + encodeURIComponent(target.scriptId);
  const sourceStart = clock();
  const [head, v56, v57, mappings, sheet, formulas] = await Promise.all([
    readGoogle(api + '/content'), readGoogle(api + '/content?versionNumber=56'),
    readGoogle(api + '/content?versionNumber=57'), readGoogle(api + '/deployments'),
    readGoogle('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(target.sheetId) +
      '/values:batchGet?' + new URLSearchParams([['valueRenderOption', 'UNFORMATTED_VALUE'],
        ['dateTimeRenderOption', 'SERIAL_NUMBER'], ...Object.entries(columns).map(([n, col]) => ['ranges', "'" + n + "'!A:" + col])])),
    readGoogle('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(target.sheetId) +
      '/values:batchGet?' + new URLSearchParams([['valueRenderOption', 'FORMULA'],
        ['dateTimeRenderOption', 'SERIAL_NUMBER'], ...Object.entries(columns).map(([n, col]) => ['ranges', "'" + n + "'!A:" + col])]))]);
  const verification = json(path.join(root, 'verification.json'));
  const substitutions = verifyRemoteBaseline({remoteFiles: normalizeRemoteFiles(v56.files),
    baselineFiles: local('v56'), sanitizations: verification.repositorySanitizations});
  assert.deepEqual(normalizeRemoteFiles(head.files), normalizeRemoteFiles(v56.files), 'HEAD not exact v56');
  assert.deepEqual(normalizeRemoteFiles(v57.files), materializeCandidate(local('v57'),
    verification.repositorySanitizations, substitutions), 'numbered57 differs');
  const production = mappings.deployments.filter(d => (d.entryPoints || []).some(e =>
    e.webApp?.url === substitutions.appsScriptProductionUrl));
  assert.equal(production.length, 1); assert.equal(production[0].deploymentConfig.versionNumber, 56);
  const candidateDir = path.join(root, 'candidates/v57');
  const candidateTreeSha256 = sourceTreeSha256(candidateDir, fs.readdirSync(candidateDir));
  assert.equal(candidateTreeSha256, verification.candidates.v57.sourceTreeSha256);
  const baselineDir = path.join(root, 'candidates/v56');
  const immutableBaselineDir = path.join(root, 'versions/v56');
  const baselineTreeSha256 = sourceTreeSha256(baselineDir, fs.readdirSync(baselineDir));
  assert.equal(baselineTreeSha256, sourceTreeSha256(immutableBaselineDir, fs.readdirSync(immutableBaselineDir)),
    'baseline planner differs from immutable v56');
  const sheetCheckedAt = clock(); const rows = decodeRows(sheet.valueRanges);
  assert.deepEqual(Object.keys(rows).sort(), Object.keys(columns).sort(), 'incomplete Sheet receipt');
  const capture = await collectPlans({rows, native, now, readCalendar}); capture.sheetCheckedAt = sheetCheckedAt;
  const nativeAfter = await readNative();
  assert.equal(fingerprint(nativeAfter.scan), fingerprint(native.scan), 'cursor changed during collection');
  assert.equal(fingerprint(nativeAfter.generation), fingerprint(native.generation), 'sync changed during collection');
  if(native.adapter==='native-ui-challenge-v1') {
    const book=memoryWorkbook(rows),f=loadBundle('v56',{SpreadsheetApp:book.service});
    assert.equal(native.scan.calendarFingerprint,f.context.getDmsCalendarFingerprint_(target.calendarId),'wrong native calendar');
    native.safety=collectorSafety(rows,capture,native,f.context);
    nativeAfter.safety=collectorSafety(rows,capture,nativeAfter,f.context);
    assert.equal(book.writes.length,0);
  }
  const safetyReport = Object.fromEntries(SAFETY_TYPES.map(key => [key, native.safety?.[key]]));
  const identities = {releaseCommitSha, candidateTreeSha256, numberedSourceSha256: candidateTreeSha256,
    baselineTreeSha256};
  const artifact = {formatVersion: 1, finishedAt: clock(), native, nativeAfter, capture,
    sources: {head, v56, v57, production: production[0]}, sheet, formulas,
    status: 'NO_GO', productionMutations: 0};
  try {
    assert.ok(Date.parse(nativeAfter.checkedAt) >= Date.parse(sheetCheckedAt), 'independent native re-read missing');
    assert.equal(fingerprint(nativeAfter.safety), fingerprint(native.safety), 'native safety changed during collection');
    const result = compileCalendarAcceptance({capture, safetyReport, identities,
      businessRevision: sheetBusinessRevision(sheet.valueRanges, formulas.valueRanges),
      observedAt: {source: sourceStart, safety: native.checkedAt, cursor: native.checkedAt}});
    assert.ok(Date.parse(clock()) <= Date.parse(result.package.expiresAt), 'collection expired');
    artifact.acceptance = result; artifact.status = 'AWAITING_SEPARATE_APPROVAL';
  } catch (error) { artifact.reason = error.message; }
  return artifact;
}

export function writeImmutableEvidence(output, artifact) {
  assert.ok(path.isAbsolute(output) && isOutsidePath(repo, output), 'private output outside repository required');
  assert.ok(isOutsidePath(fs.realpathSync(repo), fs.realpathSync(path.dirname(output))), 'private parent resolves inside repo');
  const body = {...artifact, artifactFingerprint: fingerprint(artifact)};
  const fd = fs.openSync(output, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(body, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return body.artifactFingerprint;
}

async function main() {
  assert.equal(process.cwd(), repo, 'run from repository root');
  assert.equal(process.argv.length, 4, 'usage: node collect-calendar-release.mjs private-config.json private-output.json');
  const [configPath, output] = process.argv.slice(2);
  assertPrivateRegularFile(configPath, repo, 'collector config'); const cfg = json(configPath);
  for (const key of ['readerProfile', 'calendarProfile']) assertPrivateRegularFile(cfg[key], repo, key);
  const live=cfg.nativeAdapter==='native-ui-challenge-v1';
  if(!live)assertPrivateRegularFile(cfg.nativeReceipt,repo,'nativeReceipt');
  const calendarProfile = json(cfg.calendarProfile);
  assert.deepEqual(calendarProfile.scopes, ['https://www.googleapis.com/auth/calendar.events.readonly']);
  const [readerToken, calendarToken] = await Promise.all([
    refreshGoogleAccessToken(loadAuthorizationProfile(cfg.readerProfile, 'reader')), refreshGoogleAccessToken(calendarProfile)]);
  const artifact = await collectReleaseEvidence({target: cfg.target,
    releaseCommitSha: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
    readNative: live?nativeUiChannel({directory:cfg.nativeDirectory,target:cfg.target,repo}):async () => json(cfg.nativeReceipt), readGoogle: url => googleJson(readerToken, url),
    readCalendar: async q => {
      assert.equal(q.id, cfg.target.calendarId, 'unexpected calendar');
      const base = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(q.id) + '/events';
      const p = new URLSearchParams(q.method === 'list' ? q.params : {});
      const fields = 'id,etag,summary,status,updated,start,end,recurringEventId,originalStartTime';
      p.set('fields', q.method === 'list' ? 'items(' + fields + '),nextPageToken' : fields);
      try { return await googleJson(calendarToken, base + (q.method === 'get' ? '/' + encodeURIComponent(q.params) : '') + '?' + p); }
      catch (error) { if (q.method === 'get' && /Google API (404|410):/.test(error.message)) return {missing: true}; throw error; }
    }});
  // A file receipt is not a second live native read. The CLI deliberately refuses
  // activation admission until a supported live native adapter is installed.
  if(!live){artifact.status = 'DIAGNOSTIC_ONLY'; delete artifact.acceptance;
    artifact.reason = 'Saved file receipt is not a live native read';}
  else if(artifact.acceptance)artifact.status='RELEASE_ACCEPTANCE_CAPABLE';
  const hash = writeImmutableEvidence(output, artifact);
  console.log(JSON.stringify({status: artifact.status, artifactFingerprint: hash,
    drift: artifact.capture.before.issueCount, projected: artifact.capture.after.issueCount,
    ...artifact.capture.plannerCounts, productionMutations: 0}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => {
  console.error('Read-only collection failed; no acceptance package issued. Inspect private inputs.'); process.exitCode = 1;
  console.error(String(error.stack).split('\n').filter(line => /^\s+at /.test(line)).slice(0, 3).join('\n'));
});
