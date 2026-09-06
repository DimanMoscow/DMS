// A new HEAD starts closed. Only the verified, drained v51 rollout may enable
// mutations. This also covers installable triggers, which execute HEAD.
function assertDmsP1ReleaseReady_() {
  if (PropertiesService.getScriptProperties().getProperty('DMS_P1_RELEASE_READY') !== 'v51') {
    throw new Error('DMS release maintenance: mutations are paused.');
  }
}

// Run in the original bound document, never in a web-app context. Output is
// counts only; raw legacy payloads and operational identifiers stay private.
function inspectDmsP1ReleaseState() {
  const document = PropertiesService.getDocumentProperties();
  if (!document) throw new Error('Original document context required.');
  const values = document.getProperties();
  const states = {pending: 0, consumed: 0, revoked: 0, expired: 0, unknown: 0, malformed: 0};
  Object.keys(values).filter(function(key) { return /^DMS_TG_CF_[a-f0-9]{16}$/.test(key); })
    .forEach(function(key) {
      let state;
      try { state = JSON.parse(values[key]); } catch (ignore) { states.malformed++; return; }
      if (!state || state.id !== key.substring(10) || !state.operationId) { states.malformed++; return; }
      const status = state.status === 'pending' && Date.parse(state.expiresAt) < Date.now() ? 'expired' : state.status;
      states[Object.prototype.hasOwnProperty.call(states, status) ? status : 'unknown']++;
    });
  const sheet = SpreadsheetApp.getActive().getSheetByName(DMS_TELEGRAM_CONFIRMATION.LEDGER);
  if (!sheet) throw new Error('Operation ledger unavailable.');
  const events = {};
  const count = Math.max(0, sheet.getLastRow() - 1);
  if (count) sheet.getRange(2, 5, count, 1).getValues().forEach(function(row) {
    const key = ['ticket', 'pending', 'started', 'result', 'committed', 'failed',
      'manual_review', 'legacy_ticket_preserved', 'ticket_consumed', 'ticket_revoked',
      'ticket_expired'].indexOf(String(row[0])) >= 0 ? String(row[0]) : 'other';
    events[key] = (events[key] || 0) + 1;
  });
  const report = {checkedAt: new Date().toISOString(), originalDocumentContext: true,
    usage: getDmsPropertyUsage_(), legacyStates: states, ledgerRows: count, ledgerEvents: events,
    mutationReady: PropertiesService.getScriptProperties().getProperty('DMS_P1_RELEASE_READY') === 'v51',
    drainStartedAt: PropertiesService.getScriptProperties().getProperty('DMS_P1_DRAIN_STARTED_AT') || null,
    scriptLockAvailable: !!LockService.getScriptLock(), documentLockAvailable: !!LockService.getDocumentLock()};
  console.log(JSON.stringify(report));
  return report;
}

// Called only after API read-back and the public probe prove v51 is serving.
// Starting/restarting the timer never enables a write path.
function startDmsP1ExecutionDrain() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('DMS_P1_RELEASE_READY')) throw new Error('Release is already enabled.');
  const startedAt = new Date().toISOString();
  properties.setProperty('DMS_P1_DRAIN_STARTED_AT', startedAt);
  console.log(JSON.stringify({drainStartedAt: startedAt, minimumWaitSeconds: 420}));
}

// Activation is the last step, after the versioned migrations and private
// recovery verification. A failed gate leaves all cooperating writers paused.
function activateDmsP1Release() {
  const mutex = LockService.getScriptLock();
  if (!mutex || !mutex.tryLock(10000)) throw new Error('Script lock unavailable.');
  try {
    const properties = PropertiesService.getScriptProperties();
    const start = Date.parse(properties.getProperty('DMS_P1_DRAIN_STARTED_AT') || '');
    if (!isFinite(start) || Date.now() - start < 420000) throw new Error('Old executions have not drained.');
    getTelegramOperationLedger_();
    const financial = getDmsFinancialHealth_();
    if (!financial.ok) throw new Error('Financial migration numeric gate failed.');
    const inventory = inspectDmsP1ReleaseState();
    if (inventory.legacyStates.malformed) throw new Error('Malformed legacy evidence requires private recovery.');
    properties.setProperty('DMS_P1_RELEASE_READY', 'v51');
    console.log(JSON.stringify({mutationReady: true, financialGate: true, legacyEvidenceRetained: true}));
  } finally { mutex.releaseLock(); }
}
