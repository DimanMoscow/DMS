import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

export function loadBundle(candidate = 'v51', overrides = {}) {
  const writes = [];
  const logs = [];
  const properties = new Map([
    ['DMS_TG_WEBHOOK_SECRET', 'fixture-webhook'],
    ['DMS_TG_ADMIN_USER_IDS', '1001'],
    ['DMS_TG_CHAT_ID', '2002'],
  ]);
  const store = {
    getProperty: key => properties.get(key) ?? null,
    setProperty: (key, value) => properties.set(key, String(value)),
    deleteProperty: key => properties.delete(key),
    getProperties: () => Object.fromEntries(properties),
  };
  const cache = new Map();
  const sheet = {
    appendRow: row => writes.push({method: 'appendRow', row}),
    getRange: () => ({setValues: values => writes.push({method: 'setValues', values})}),
    setFrozenRows: () => writes.push({method: 'setFrozenRows'}),
  };
  const context = vm.createContext({
    Date, console: {error: (...args) => logs.push(args.join(' ')), log: () => {}},
    PropertiesService: {getScriptProperties: () => store, getDocumentProperties: () => store},
    CacheService: {getScriptCache: () => ({
      get: key => cache.get(key) ?? null,
      put: (key, value) => cache.set(key, value),
      remove: key => cache.delete(key),
    })},
    // Google documents that web app executions have no DocumentLock.
    LockService: {getDocumentLock: () => null},
    SpreadsheetApp: {getActive: () => ({
      getSheetByName: () => sheet,
      insertSheet: () => {writes.push({method: 'insertSheet'}); return sheet;},
      getSpreadsheetTimeZone: () => 'Europe/Moscow',
    }), flush: () => {}},
    Utilities: {
      formatDate: () => '20260907000000', getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(String(value)).digest()],
      base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64url'),
    },
    ContentService: {MimeType: {TEXT: 'text', JSON: 'json'},
      createTextOutput: text => ({text, setMimeType() {return this;}})},
    HtmlService: {createHtmlOutput: text => ({text})},
    ...overrides,
  });
  const root = `apps-script/candidates/${candidate}`;
  const files = fs.readdirSync(root).filter(name => name.endsWith('.gs')).sort();
  for (const name of files) {
    new vm.Script(fs.readFileSync(`${root}/${name}`, 'utf8'), {filename: `${root}/${name}`})
      .runInContext(context);
  }
  return {context, writes, logs, properties, cache, fileCount: files.length};
}
