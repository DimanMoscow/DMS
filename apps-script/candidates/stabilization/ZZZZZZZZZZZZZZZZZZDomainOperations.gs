// Transport-neutral operations introduced during System Stabilization.

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
