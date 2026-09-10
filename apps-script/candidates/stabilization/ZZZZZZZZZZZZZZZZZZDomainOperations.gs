// Transport-neutral operations introduced during System Stabilization.

const DMS_DOMAIN_OPERATION = {VERSION: 'dop1'};

function appendDmsDomainOperationEvent_(state, event, detail, payload, result) {
  const sheet = getTelegramOperationLedger_();
  sheet.appendRow([
    'DOE-' + Utilities.getUuid(), new Date(), state.operationId, state.ticketId, event, state.action,
    state.actorHash, state.transportHash, state.requestHash, state.payloadHash,
    String(result && result.code || ''),
    result && result.ref ? hashTelegramConfirmationValue_(String(result.ref)) : '',
    String(detail || '').substring(0, 160), DMS_DOMAIN_OPERATION.VERSION,
    canonicalTelegramConfirmationJson_(state),
    payload ? canonicalTelegramConfirmationJson_(payload) : '',
    result ? canonicalTelegramConfirmationJson_(result) : ''
  ]);
  SpreadsheetApp.flush();
}

function getDmsDomainOperation_(operationId) {
  const rows = getDmsOperationEvents_(3, operationId).filter(function(row) {
    return row[13] === DMS_DOMAIN_OPERATION.VERSION;
  });
  const ticketRows = rows.filter(function(row) { return row[4] === 'ticket'; });
  if (ticketRows.length > 1) throw new Error('Durable operation ticket duplicated.');
  const lifecycle = rows.filter(function(row) {
    return ['pending', 'started', 'result', 'committed', 'failed', 'manual_review'].indexOf(row[4]) !== -1;
  });
  const latest = lifecycle.length ? lifecycle[lifecycle.length - 1] : null;
  return {
    ticket: ticketRows.length ? {
      state: JSON.parse(ticketRows[0][14]), payload: JSON.parse(ticketRows[0][15])
    } : null,
    latest: latest ? {
      status: String(latest[4]), at: new Date(latest[1]).getTime(),
      result: latest[16] ? JSON.parse(latest[16]) : null
    } : null
  };
}

function runDmsDurableOperation_(request, handlers) {
  if (!DMS_MUTATION_DEPTH) throw new Error('Shared mutation lock required.');
  const input = request || {};
  const action = String(input.action || '');
  const actorId = String(input.actorId || '');
  const requestId = String(input.requestId || '').toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(action) || !/^\d{1,24}$/.test(actorId) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId) ||
      !handlers || typeof handlers.execute !== 'function') {
    throw new Error('Durable operation request invalid.');
  }
  const payload = JSON.parse(canonicalTelegramConfirmationJson_(input.payload || {}));
  const actorHash = hashTelegramConfirmationIdentity_('admin', actorId);
  const requestHash = hashTelegramConfirmationValue_('request|' + requestId);
  const operationId = 'DOP-' + hashTelegramConfirmationHex_(action + '|' + actorHash + '|' + requestId).substring(0, 24);
  const state = {
    version: DMS_DOMAIN_OPERATION.VERSION,
    operationId: operationId,
    ticketId: 'DOPT-' + hashTelegramConfirmationHex_(operationId).substring(0, 16),
    action: action,
    actorHash: actorHash,
    transportHash: hashTelegramConfirmationValue_('transport|MiniApp'),
    requestHash: requestHash,
    payloadHash: hashTelegramConfirmationValue_(canonicalTelegramConfirmationJson_({action: action, payload: payload})),
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  let existing = getDmsDomainOperation_(operationId);
  if (existing.ticket) {
    const accepted = existing.ticket.state;
    if (accepted.action !== state.action || accepted.actorHash !== state.actorHash ||
        accepted.requestHash !== state.requestHash || accepted.payloadHash !== state.payloadHash ||
        canonicalTelegramConfirmationJson_(existing.ticket.payload) !== canonicalTelegramConfirmationJson_(payload)) {
      throw new Error('Idempotency key already binds another operation.');
    }
    state.createdAt = accepted.createdAt;
  } else {
    appendDmsDomainOperationEvent_(state, 'ticket', 'immutable_payload', payload, null);
    existing = getDmsDomainOperation_(operationId);
  }
  const previous = existing.latest;
  if (previous && (previous.status === 'committed' || previous.status === 'failed')) {
    if (!previous.result) throw new Error('Durable operation result missing.');
    return previous.result;
  }
  if (previous && previous.status === 'manual_review') {
    return previous.result || {status: 'manual_review', code: 'mutation_outcome_unknown'};
  }
  if (previous && previous.status === 'result') {
    if (!previous.result) throw new Error('Durable operation result missing.');
    state.status = 'committed';
    appendDmsDomainOperationEvent_(state, 'committed', 'finalized', null, previous.result);
    return previous.result;
  }
  if (previous && previous.status === 'started') {
    let recovered = null;
    if (typeof handlers.recover === 'function') recovered = handlers.recover(payload, operationId);
    if (recovered) {
      state.status = 'committed';
      appendDmsDomainOperationEvent_(state, 'committed', 'reconciled', null, recovered);
      return recovered;
    }
    const unknown = {status: 'manual_review', code: 'mutation_outcome_unknown'};
    state.status = 'manual_review';
    appendDmsDomainOperationEvent_(state, 'manual_review', 'no_blind_replay', null, unknown);
    return unknown;
  }
  if (!previous) appendDmsDomainOperationEvent_(state, 'pending', 'accepted', null, null);
  state.status = 'started';
  appendDmsDomainOperationEvent_(state, 'started', 'mutation_intent', null, null);
  const applied = JSON.parse(canonicalTelegramConfirmationJson_(
    handlers.execute(payload, operationId) || {code: 'completed'}
  ));
  SpreadsheetApp.flush();
  state.status = applied.status === 'failed' ? 'failed' : 'result';
  appendDmsDomainOperationEvent_(state, state.status,
    applied.status === 'failed' ? 'no_mutation' : 'business_complete', null, applied);
  if (applied.status === 'failed') return applied;
  state.status = 'committed';
  appendDmsDomainOperationEvent_(state, 'committed', 'finalized', null, applied);
  return applied;
}

function markDmsDomainQueueOperation_(queueId, operationId) {
  const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM.QUEUE);
  const row = findRowByValue_(sheet, 1, queueId, DMS_TELEGRAM.QUEUE_FIRST_ROW);
  if (!row) throw new Error('Queue row unavailable after mutation.');
  const range = sheet.getRange(row, 17);
  range.setValue(mergeQueueComment_(range.getValue(), '[dop:' + operationId + ']'));
}

function recoverDmsDomainQueueDecision_(payload, operationId) {
  const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM.QUEUE);
  const row = findRowByValue_(sheet, 1, payload.queueId, DMS_TELEGRAM.QUEUE_FIRST_ROW);
  if (!row) return null;
  const values = sheet.getRange(row, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS).getValues()[0];
  const decisions = {done: 'Проведена', charge: 'Отмена со списанием', free: 'Отмена без списания'};
  if (String(values[12] || '') !== decisions[payload.decision] ||
      String(values[16] || '').indexOf('[dop:' + operationId + ']') === -1) return null;
  return {
    code: 'queue_decision_saved', ref: String(values[0]), changed: true,
    date: values[1], notice: decisions[payload.decision], decision: payload.decision,
    queueId: String(values[0]), client: String(values[9] || values[7] || 'Не распознано'),
    start: values[5], end: values[6]
  };
}

function getDmsDurableOperationHealth_() {
  const sheet = getTelegramOperationLedger_();
  const lastRow = sheet.getLastRow();
  const latest = {};
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 17).getValues().forEach(function(row) {
      const protocol = String(row[13] || '');
      const event = String(row[4] || '');
      const operationId = String(row[2] || '');
      if (['cf2', DMS_DOMAIN_OPERATION.VERSION].indexOf(protocol) === -1 || !operationId ||
          ['pending', 'started', 'result', 'committed', 'failed', 'manual_review'].indexOf(event) === -1) return;
      latest[protocol + '|' + operationId] = {
        protocol: protocol, status: event, at: new Date(row[1]).getTime(), code: String(row[10] || '')
      };
    });
  }
  const now = Date.now();
  const health = {state: 'healthy', total: Object.keys(latest).length, pending: 0,
    stale: 0, manualReview: 0, failed: 0, committed: 0,
    protocols: {cf2: 0, dop1: 0}, latestErrorClasses: {}};
  Object.keys(latest).forEach(function(key) {
    const item = latest[key];
    health.protocols[item.protocol]++;
    if (item.status === 'manual_review') health.manualReview++;
    else if (item.status === 'failed') health.failed++;
    else if (item.status === 'committed') health.committed++;
    else if (now - item.at >= DMS_OPERATION_V2.STALE_MS) health.stale++;
    else health.pending++;
    if (item.status === 'manual_review' || item.status === 'failed') {
      const errorClass = item.code === 'underlying_state_changed' || item.code === 'day_not_ready'
        ? 'validation' : item.status === 'manual_review' ? 'manual_review' : 'runtime_error';
      health.latestErrorClasses[errorClass] = (health.latestErrorClasses[errorClass] || 0) + 1;
    }
  });
  if (health.manualReview) health.state = 'manual_review';
  else if (health.stale) health.state = 'stale';
  return health;
}

function getDmsOperationMetricsHealth_() {
  const operations = {};
  let contentionAnomalies = 0;
  const latestErrorClasses = {};
  Object.keys(DMS_OPERATION_METRICS.OPERATIONS).forEach(function(operation) {
    const metric = getDmsOperationMetric_(operation);
    if (!metric) return;
    operations[operation] = metric;
    if (metric.errorClass === 'contention') contentionAnomalies++;
    if (metric.errorClass) {
      latestErrorClasses[metric.errorClass] = (latestErrorClasses[metric.errorClass] || 0) + 1;
    }
  });
  return {state: contentionAnomalies ? 'failed' : 'healthy', contentionAnomalies: contentionAnomalies,
    latestErrorClasses: latestErrorClasses, operations: operations};
}

function normalizeDmsOperationalState_(state) {
  const value = String(state || 'failed');
  if (['healthy', 'not_due_yet', 'awaiting_sync', 'delayed', 'failed', 'stale',
    'manual_review'].indexOf(value) >= 0) return value;
  if (value === 'last_run_succeeded') return 'healthy';
  if (value === 'within_expected_window') return 'not_due_yet';
  if (value === 'sync_delayed') return 'delayed';
  if (value === 'sync_failed' || value === 'sync_trigger_missing' ||
      value === 'accounting_drift' || value === 'drift_after_successful_sync' ||
      value === 'last_run_failed' || value === 'trigger_missing' ||
      value === 'trigger_misconfigured') return 'failed';
  return 'failed';
}

function normalizeDmsScheduledHealth_(scheduled) {
  if (!scheduled) return {state: 'failed', ok: false, handlers: []};
  const result = {};
  Object.keys(scheduled).forEach(function(key) { result[key] = scheduled[key]; });
  result.handlers = (scheduled.handlers || []).map(function(item) {
    const normalized = {};
    Object.keys(item).forEach(function(key) { normalized[key] = item[key]; });
    normalized.evidenceState = item.state;
    normalized.state = normalizeDmsOperationalState_(item.state);
    return normalized;
  });
  const states = result.handlers.map(function(item) { return item.state; });
  result.state = !scheduled.configOk || !scheduled.settingsOk || states.indexOf('failed') >= 0 ? 'failed' :
    states.indexOf('stale') >= 0 ? 'stale' :
      states.indexOf('delayed') >= 0 ? 'delayed' : 'healthy';
  return result;
}

function getDmsOperationalHealth_() {
  const report = runDmsReadOnlySelfTests({watchdog: true});
  const latestErrorClasses = {};
  const collectErrors = function(values) {
    Object.keys(values || {}).forEach(function(name) {
      latestErrorClasses[name] = (latestErrorClasses[name] || 0) + Number(values[name] || 0);
    });
  };
  collectErrors(report.durableOperations && report.durableOperations.latestErrorClasses);
  collectErrors(report.operationMetrics && report.operationMetrics.latestErrorClasses);
  (report.scheduledAutomation && report.scheduledAutomation.handlers || []).forEach(function(item) {
    if (!item.lastErrorClass || !item.lastErrorAt ||
        item.lastSuccessAt && Date.parse(item.lastSuccessAt) >= Date.parse(item.lastErrorAt)) return;
    latestErrorClasses[item.lastErrorClass] = (latestErrorClasses[item.lastErrorClass] || 0) + 1;
  });
  const calendarIngestion = report.calendarIngestion || {state: 'failed'};
  const normalizedCalendar = {};
  Object.keys(calendarIngestion).forEach(function(key) { normalizedCalendar[key] = calendarIngestion[key]; });
  normalizedCalendar.evidenceState = calendarIngestion.state;
  normalizedCalendar.state = normalizeDmsOperationalState_(calendarIngestion.state);
  const scheduled = normalizeDmsScheduledHealth_(report.scheduledAutomation);
  const componentStates = [normalizedCalendar.state, scheduled.state,
    report.backup && report.backup.state, report.reconciliation && report.reconciliation.state,
    report.durableOperations && report.durableOperations.state,
    report.operationMetrics && report.operationMetrics.state,
    report.measurements && report.measurements.state];
  const componentChecks = {
    'scheduled-trigger-config': true,
    'scheduled-notification-settings': true,
    'scheduled-trigger-freshness': true,
    'calendar-queue-journal-reconciliation': true,
    'latest-backup-integrity': true,
    'durable-operation-lifecycle': true,
    'operation-contention-anomalies': true,
    'measurement-corruption': true
  };
  const independentFailure = (report.checks || []).some(function(check) {
    return !check.ok && !componentChecks[check.name];
  });
  const overallState = componentStates.indexOf('manual_review') >= 0 ? 'manual_review' :
    componentStates.indexOf('failed') >= 0 || independentFailure ? 'failed' :
      componentStates.indexOf('stale') >= 0 ? 'stale' :
        componentStates.indexOf('delayed') >= 0 ? 'delayed' : 'healthy';
  return {
    state: overallState,
    checkedAt: report.checkedAt,
    durationMs: report.durationMs,
    runtime: getDmsRuntimeIdentity_(),
    calendarIngestion: normalizedCalendar,
    reconciliation: report.reconciliation || {state: 'failed', ok: false},
    scheduledAutomation: scheduled,
    backup: report.backup,
    durableOperations: report.durableOperations,
    metrics: report.operationMetrics,
    measurements: report.measurements,
    latestErrorClasses: latestErrorClasses,
    system: report.system,
    checks: report.checks
  };
}

function getDmsDayAcceptanceRows_(dateKey) {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const rows = [];
  const lastRow = queue.getLastRow();
  if (lastRow < DMS_TELEGRAM.QUEUE_FIRST_ROW) return rows;
  queue.getRange(DMS_TELEGRAM.QUEUE_FIRST_ROW, 1,
    lastRow - DMS_TELEGRAM.QUEUE_FIRST_ROW + 1, DMS_TELEGRAM.QUEUE_COLUMNS)
    .getValues().forEach(function(values) {
      if (!values[0] || !(values[1] instanceof Date) ||
          makeDateKey_(values[1], timeZone) !== dateKey || String(values[13] || '') === 'Обработано') return;
      rows.push({
        queueId: String(values[0]),
        decision: String(values[12] || ''),
        status: String(values[13] || '')
      });
    });
  return rows.sort(function(left, right) { return left.queueId.localeCompare(right.queueId); });
}

function normalizeDmsDayAcceptanceRows_(rows) {
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('Accepted day rows invalid.');
  const seen = {};
  return rows.map(function(row) {
    const normalized = {
      queueId: String(row && row.queueId || ''),
      decision: String(row && row.decision || ''),
      status: String(row && row.status || '')
    };
    if (!/^Q-[A-Za-z0-9_-]+$/.test(normalized.queueId) || seen[normalized.queueId] ||
        normalized.decision.length > 80 || normalized.status.length > 80) {
      throw new Error('Accepted day rows invalid.');
    }
    seen[normalized.queueId] = true;
    return normalized;
  }).sort(function(left, right) { return left.queueId.localeCompare(right.queueId); });
}

function executeDmsDayConfirmation_(command, metrics) {
  if (!DMS_MUTATION_DEPTH) throw new Error('Shared mutation lock required.');
  const input = command || {};
  const dateKey = String(input.dateKey || '');
  const source = String(input.source || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || ['Telegram', 'MiniApp'].indexOf(source) === -1) {
    throw new Error('Day confirmation command invalid.');
  }
  const acceptedRows = normalizeDmsDayAcceptanceRows_(input.acceptedRows || []);
  const currentRows = getDmsDayAcceptanceRows_(dateKey);
  if (canonicalTelegramConfirmationJson_(acceptedRows) !== canonicalTelegramConfirmationJson_(currentRows)) {
    return {status: 'failed', code: 'underlying_state_changed', ref: dateKey, dateKey: dateKey,
      changed: false, total: 0, added: 0, skipped: 0, alreadyLogged: 0, blocked: 0,
      blockers: [], calendarDeleted: 0, calendarAlreadyMissing: 0, calendarFailed: 0};
  }

  const previousConfirmedExecution = DMS_CONFIRMED_EXECUTION;
  if (!previousConfirmedExecution && Array.isArray(input.calendarTargets)) {
    DMS_CONFIRMED_EXECUTION = {
      state: {operationId: String(input.operationId || '')},
      payload: {calendarTargets: JSON.parse(canonicalTelegramConfirmationJson_(input.calendarTargets))}
    };
  }
  try {
  if (DMS_CONFIRMED_EXECUTION) assertDmsConfirmedCalendarCurrent_(DMS_CONFIRMED_EXECUTION.payload);
  const date = parseTelegramDateKey_(dateKey);
  const preflight = measureDmsOperationPhase_(metrics, 'sheetsReadMs', function() {
    return processQueueDate_(date, source, true, {lockHeld: true, projectPlannedActivations: true});
  });
  if (Number(preflight.blocked || 0) > 0 || (preflight.blockers || []).length > 0) {
    return {status: 'failed', code: 'day_not_ready', ref: dateKey, dateKey: dateKey,
      changed: false, total: Number(preflight.total || 0), added: 0, skipped: 0,
      alreadyLogged: Number(preflight.alreadyLogged || 0), blocked: Number(preflight.blocked || 0),
      blockers: (preflight.blockers || []).slice(0, 50), calendarDeleted: 0,
      calendarAlreadyMissing: 0, calendarFailed: 0};
  }

  let result;
  let calendarResult;
  measureDmsOperationPhase_(metrics, 'sheetsWriteMs', function() {
    result = processQueueDate_(date, source, false, {lockHeld: true});
    calendarResult = applyTelegramCalendarCancellationsForDate_(date);
  });
  if (Number(result.blocked || 0) > 0 || (result.blockers || []).length > 0) {
    throw new Error('Day preflight invariant changed during locked execution.');
  }
  const incomplete = Number(calendarResult.failed || 0) > 0;
  return {
    code: incomplete ? 'day_partial' : 'day_confirmed',
    ref: dateKey,
    dateKey: dateKey,
    changed: Boolean(result.added || result.skipped || result.alreadyLogged),
    total: Number(result.total || 0),
    added: Number(result.added || 0),
    skipped: Number(result.skipped || 0),
    alreadyLogged: Number(result.alreadyLogged || 0),
    blocked: 0,
    blockers: [],
    calendarDeleted: Number(calendarResult.deleted || 0),
    calendarAlreadyMissing: Number(calendarResult.alreadyMissing || 0),
    calendarFailed: Number(calendarResult.failed || 0)
  };
  } finally {
    DMS_CONFIRMED_EXECUTION = previousConfirmedExecution;
  }
}
