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
      parseDate: (value, timeZone, pattern) => {
        if (timeZone !== 'Europe/Moscow' || pattern !== 'yyyy-MM-dd HH:mm') throw new Error('Unsupported fixture date format');
        return new Date(value.replace(' ', 'T') + ':00+03:00');
      },
      formatDate: (date, timeZone, pattern) => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone,
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
          minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).formatToParts(date).map(p => [p.type, p.value]));
        const tokens = {yyyy: parts.year, MM: parts.month, dd: parts.day,
          HH: parts.hour, mm: parts.minute, ss: parts.second};
        return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, token => tokens[token]);
      }, getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(String(value)).digest()],
      base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64url'),
      newBlob: value => ({getBytes: () => [...Buffer.from(String(value))]}),
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
