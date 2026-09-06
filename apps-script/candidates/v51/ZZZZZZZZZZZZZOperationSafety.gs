// One mutex for all cooperating executions of this script project. Each caller
// owns a lease; nested domain helpers cannot release an outer transaction's lock.
var DMS_MUTATION_MUTEX = null;
var DMS_MUTATION_DEPTH = 0;
var DMS_CONFIRMED_EXECUTION = null;

function getDmsMutationLock_() {
  let acquired = false;
  return {
    tryLock: function(timeout) {
      if (acquired) return true;
      if (!DMS_MUTATION_DEPTH) {
        const mutex = LockService.getScriptLock();
        if (!mutex || typeof mutex.tryLock !== 'function') throw new Error('Script lock unavailable.');
        if (!mutex.tryLock(timeout)) return false;
        DMS_MUTATION_MUTEX = mutex;
      }
      DMS_MUTATION_DEPTH++;
      acquired = true;
      return true;
    },
    waitLock: function(timeout) {
      if (!this.tryLock(timeout)) throw new Error('Другое действие ещё выполняется.');
    },
    hasLock: function() { return acquired && DMS_MUTATION_DEPTH > 0; },
    releaseLock: function() {
      if (!acquired) return;
      acquired = false;
      DMS_MUTATION_DEPTH--;
      if (!DMS_MUTATION_DEPTH) {
        const mutex = DMS_MUTATION_MUTEX;
        DMS_MUTATION_MUTEX = null;
        try { SpreadsheetApp.flush(); } finally { mutex.releaseLock(); }
      }
    }
  };
}

function withTelegramDocumentLock_(callback) {
  const lease = getDmsMutationLock_();
  if (!lease.tryLock(10000)) throw new Error('Другое действие ещё выполняется.');
  try { return callback(); } finally { lease.releaseLock(); }
}

function getDmsConfirmedState_(kind, userId, chatId) {
  if (!DMS_CONFIRMED_EXECUTION) return undefined;
  const context = DMS_CONFIRMED_EXECUTION;
  if (String(userId) !== String(context.userId) || String(chatId) !== String(context.chatId) ||
      context.payload.stateKind !== kind || !context.payload.state) {
    throw new Error('Confirmed operation context differs.');
  }
  const state = JSON.parse(canonicalTelegramConfirmationJson_(context.payload.state));
  state.secureOperationId = context.state.operationId;
  return state;
}

function makeTelegramStateConfirmationPayload_(legacyData, stateKind, state) {
  return {legacyData: legacyData, stateKind: stateKind,
    state: JSON.parse(canonicalTelegramConfirmationJson_(state))};
}

function getDmsConfirmedBusinessHash_() {
  const ss = SpreadsheetApp.getActive();
  const values = ['Клиенты', 'Блоки', 'Оплаты', 'Журнал тренировок',
    'Очередь подтверждения', 'Настройки'].map(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('Required business sheet unavailable.');
    const last = sheet.getLastRow();
    return {sheet: name, values: last ? sheet.getRange(1, 1, last, sheet.getLastColumn()).getValues() : []};
  });
  values.push({settings: PropertiesService.getScriptProperties().getProperty('DMS_TG_FINAL_SETTINGS') || ''});
  return hashTelegramConfirmationValue_(canonicalTelegramConfirmationJson_(values));
}

function getDmsConfirmationCalendarTargets_(payload) {
  const targets = [];
  function add(calendarId, eventId) {
    if (calendarId && eventId && !targets.some(function(t) { return t.calendarId === calendarId && t.eventId === eventId; })) {
      targets.push({calendarId: String(calendarId), eventId: String(eventId)});
    }
  }
  const data = String(payload.legacyData || ''); const state = payload.state || {};
  if (state.action === 'upcoming') {
    const item = getTelegramUpcomingStateItem_(state, state.selectedIndex);
    add(state.calendarId, item.id);
  }
  if (data === '__secure:queueMove' || data.indexOf('qp:') === 0) {
    const queue = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM.QUEUE);
    const last = queue.getLastRow();
    const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    if (last >= 4) queue.getRange(4, 1, last - 3, 17).getValues().forEach(function(row) {
      if ((data === '__secure:queueMove' && String(row[0]) === String(state.queueId)) ||
          (data.indexOf('qp:') === 0 && row[1] instanceof Date && makeDateKey_(row[1], tz) === data.substring(3))) {
        add(row[2], row[3]);
      }
    });
  }
  if (data.indexOf('ops:undoYes:') === 0) {
    const audit = getOrCreateTelegramAuditSheet_();
    const row = findRowByValue_(audit, 1, data.substring(12), 2);
    if (!row) throw new Error('Undo record unavailable.');
    function collect(undo) {
      if (undo.calendarId && undo.eventId) add(undo.calendarId, undo.eventId);
      (undo.items || []).forEach(collect);
      (undo.steps || []).forEach(collect);
    }
    collect(JSON.parse(audit.getRange(row, 6).getValue()));
  }
  return targets.map(function(target) {
    let event;
    try { event = Calendar.Events.get(target.calendarId, target.eventId); }
    catch (error) {
      if (!isCalendarEventMissingError_(error)) throw error;
      return {calendarId: target.calendarId, eventId: target.eventId, absent: true};
    }
    if (!event.etag) throw new Error('Calendar version unavailable.');
    if (state.confirmedCalendarEtag && event.etag !== state.confirmedCalendarEtag) throw new Error('Calendar preview changed.');
    return {calendarId: target.calendarId, eventId: target.eventId, etag: event.etag,
      start: event.start, end: event.end, status: event.status || 'confirmed'};
  });
}

function buildDmsExactDayConfirmationText_(dateKey) {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
  const lines = ['<b>Подтвердить день ' + escapeTelegramHtml_(dateKey) + '?</b>'];
  const last = queue.getLastRow();
  if (last >= 4) queue.getRange(4, 1, last - 3, 17).getValues().forEach(function(row) {
    if (row[1] instanceof Date && makeDateKey_(row[1], ss.getSpreadsheetTimeZone()) === dateKey) {
      lines.push(escapeTelegramHtml_([row[0], row[9] || row[7], row[12], row[13]].join(' · ')));
    }
  });
  const text = lines.join('\n');
  if (text.length > 3400) throw new Error('День слишком большой для одного подтверждения. Требуется ручная проверка.');
  return text;
}

function assertDmsConfirmedCalendarCurrent_(payload) {
  (payload.calendarTargets || []).forEach(function(target) {
    let event;
    try { event = Calendar.Events.get(target.calendarId, target.eventId); }
    catch (error) {
      if (target.absent && isCalendarEventMissingError_(error)) return;
      throw error;
    }
    if (target.absent || event.etag !== target.etag) throw new Error('Calendar state changed after confirmation.');
  });
}

function dmsCalendarConditionalWrite_(method, calendarId, eventId, resource) {
  const context = DMS_CONFIRMED_EXECUTION;
  const targets = context.payload.calendarTargets || [];
  const target = targets.find(function(t) { return t.calendarId === String(calendarId) && t.eventId === String(eventId); });
  if (!target) throw new Error('Calendar target was not confirmed.');
  if (target.absent) throw new Error('Calendar event Not Found (404).');
  const request = {
      method: method, headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'If-Match': target.etag},
      contentType: 'application/json', muteHttpExceptions: true
    };
  if (resource) request.payload = JSON.stringify(resource);
  const response = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/calendars/' +
    encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId) + '?sendUpdates=none', request);
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('Calendar conditional write failed (' + status + ').');
  const body = response.getContentText();
  return body ? JSON.parse(body) : null;
}

function dmsCalendarPatch_(resource, calendarId, eventId, options) {
  if (!DMS_CONFIRMED_EXECUTION) return Calendar.Events.patch(resource, calendarId, eventId, options);
  return dmsCalendarConditionalWrite_('patch', calendarId, eventId, resource);
}

function dmsCalendarRemove_(calendarId, eventId, options) {
  if (!DMS_CONFIRMED_EXECUTION) return Calendar.Events.remove(calendarId, eventId, options);
  return dmsCalendarConditionalWrite_('delete', calendarId, eventId);
}

function dmsCalendarInsert_(resource, calendarId, options) {
  if (DMS_CONFIRMED_EXECUTION) {
    resource.id = 'dms' + hashTelegramConfirmationHex_(DMS_CONFIRMED_EXECUTION.state.operationId);
  }
  return Calendar.Events.insert(resource, calendarId, options);
}

// Ticket and accepted payload live in the append-only ledger. Properties are
// never used as an unbounded per-ticket database in cf2. Cache is only a hint.
const DMS_OPERATION_V2 = {
  VERSION: 'cf2', CANCEL_VERSION: 'cx2',
  EXTRA_HEADERS: ['Protocol', 'Ticket JSON', 'Payload JSON', 'Result JSON'],
  STALE_MS: 120000, MAX_PAYLOAD_CHARS: 20000
};

function getTelegramOperationLedger_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(DMS_TELEGRAM_CONFIRMATION.LEDGER);
  if (!sheet) throw new Error('Operation schema migration required.');
  const expected = DMS_TELEGRAM_CONFIRMATION.LEDGER_HEADERS.concat(DMS_OPERATION_V2.EXTRA_HEADERS);
  const actual = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0];
  if (canonicalTelegramConfirmationJson_(actual) !== canonicalTelegramConfirmationJson_(expected)) {
    throw new Error('Operation schema migration required.');
  }
  return sheet;
}

function appendTelegramOperationEvent_(state, event, code, ref, detail, payload, result) {
  const sheet = getTelegramOperationLedger_();
  sheet.appendRow([
    'TGE-' + Utilities.getUuid(), new Date(), state.operationId, state.id, event, state.action,
    state.adminHash, state.chatHash, state.messageId, state.payloadHash, String(code || ''),
    ref ? hashTelegramConfirmationValue_(String(ref)) : '', String(detail || '').substring(0, 160),
    'cf2', canonicalTelegramConfirmationJson_(state),
    payload ? canonicalTelegramConfirmationJson_(payload) : '',
    result ? canonicalTelegramConfirmationJson_(result) : ''
  ]);
  SpreadsheetApp.flush();
}

function getDmsOperationEvents_(column, id) {
  const sheet = getTelegramOperationLedger_();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, column, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(id)).matchEntireCell(true).findAll()
    .sort(function(a, b) { return a.getRow() - b.getRow(); })
    .map(function(match) { return sheet.getRange(match.getRow(), 1, 1, 17).getValues()[0]; });
}

function getTelegramConfirmationState_(id) {
  const rows = getDmsOperationEvents_(4, id);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][13] === 'cf2' && rows[i][14]) return JSON.parse(rows[i][14]);
  }
  return null;
}

function getTelegramConfirmationPayload_(id) {
  const rows = getDmsOperationEvents_(4, id);
  const tickets = rows.filter(function(row) { return row[13] === 'cf2' && row[4] === 'ticket'; });
  if (tickets.length !== 1 || !tickets[0][15]) throw new Error('Immutable payload unavailable.');
  return JSON.parse(tickets[0][15]);
}

function putTelegramConfirmationState_(state) {
  appendTelegramOperationEvent_(state, 'ticket_' + state.status, '', '', 'state');
}

function getDmsPropertyUsage_() {
  function measure(store) {
    if (!store) return {available: false, bytes: 0, tickets: 0};
    const values = store.getProperties();
    let bytes = 0; let tickets = 0;
    Object.keys(values).forEach(function(key) {
      bytes += Utilities.newBlob(key + values[key]).getBytes().length;
      if (key.indexOf('DMS_TG_CF_') === 0) tickets++;
    });
    return {available: true, bytes: bytes, tickets: tickets,
      warning: bytes >= 400000, failSafe: bytes >= 450000};
  }
  return {script: measure(PropertiesService.getScriptProperties()),
    document: measure(PropertiesService.getDocumentProperties()),
    ticketStorage: 'append_only_ledger', newTicketPropertyBytes: 0};
}

function cleanupDmsLegacyConfirmationTickets_(options) {
  const settings = options || {};
  const limit = Math.max(1, Math.min(50, Number(settings.limit) || 25));
  return withTelegramDocumentLock_(function() {
    const properties = PropertiesService.getDocumentProperties();
    if (!properties) throw new Error('Legacy inventory requires original document context.');
    const inventory = properties.getProperties();
    const keys = Object.keys(inventory).filter(function(key) { return /^DMS_TG_CF_[a-f0-9]{16}$/.test(key); }).sort();
    const report = {scanned: 0, preserved: 0, deletedEphemeralKeys: 0, manualReview: 0, remaining: keys.length};
    // Cleanup is deliberately opt-in after migration, backup and old execution
    // drain. A dry run inventories without changing either store.
    if (!settings.dryRun && settings.legacyExecutionsDrained !== true) throw new Error('Legacy execution drain required.');
    keys.slice(0, limit).forEach(function(key) {
      const raw = inventory[key];
      let state;
      try { state = JSON.parse(raw); } catch (ignore) { throw new Error('Malformed legacy ticket requires private recovery.'); }
      if (!state || state.id !== key.substring(10) || !state.operationId) throw new Error('Legacy ticket identity differs.');
      report.scanned++;
      const operations = getDmsOperationEvents_(3, state.operationId);
      const lifecycle = operations.filter(function(row) { return ['pending', 'committed', 'failed'].indexOf(row[4]) !== -1; });
      const latest = lifecycle.length ? lifecycle[lifecycle.length - 1][4] : '';
      const uncertain = latest === 'pending' || latest === 'failed' || (!latest && state.status === 'consumed') ||
        ['pending', 'consumed', 'revoked', 'expired'].indexOf(state.status) === -1;
      if (uncertain) report.manualReview++;
      if (settings.dryRun) return;
      const existing = operations.filter(function(row) {
        return row[4] === 'legacy_ticket_preserved' && row[3] === state.id;
      });
      if (existing.length > 1 || (existing.length === 1 && existing[0][14] !== raw)) throw new Error('Legacy recovery evidence differs.');
      if (!existing.length) {
        getTelegramOperationLedger_().appendRow([
          'TGE-' + Utilities.getUuid(), new Date(), state.operationId, state.id,
          'legacy_ticket_preserved', state.action, state.adminHash, state.chatHash,
          state.messageId, state.payloadHash, uncertain ? 'manual_review' : 'legacy_revoked', '',
          'cf1_never_replayed', 'cf1', raw, '', ''
        ]);
        SpreadsheetApp.flush();
      }
      const proof = getDmsOperationEvents_(4, state.id).filter(function(row) {
        return row[4] === 'legacy_ticket_preserved' && row[14] === raw;
      });
      if (proof.length !== 1 || properties.getProperty(key) !== raw) throw new Error('Legacy ticket changed during cleanup.');
      report.preserved++;
      properties.deleteProperty(key);
      report.deletedEphemeralKeys++; report.remaining--;
    });
    return report;
  });
}

function createTelegramConfirmation_(userId, chatId, messageId, action, payload, nowMs) {
  return withTelegramDocumentLock_(function() {
    const usage = getDmsPropertyUsage_();
    if (usage.script.failSafe || usage.document.failSafe) throw new Error('Property cleanup required before confirmation.');
    const immutable = JSON.parse(canonicalTelegramConfirmationJson_(payload));
    const flowMaterial = immutable.state && immutable.state.secureFlowId
      ? canonicalTelegramConfirmationJson_(immutable) : '';
    immutable.expectedBusinessHash = getDmsConfirmedBusinessHash_();
    immutable.calendarTargets = getDmsConfirmationCalendarTargets_(immutable);
    const json = canonicalTelegramConfirmationJson_(immutable);
    if (json.length > DMS_OPERATION_V2.MAX_PAYLOAD_CHARS) throw new Error('Confirmation payload too large.');
    const now = Number(nowMs === undefined ? Date.now() : nowMs);
    const id = makeTelegramConfirmationId_(); const nonce = makeTelegramConfirmationNonce_();
    const state = {
      id: id, version: 'cf2', action: String(action),
      nonceHash: hashTelegramConfirmationValue_(getTelegramConfirmationSalt_() + '|nonce|' + nonce),
      adminHash: hashTelegramConfirmationIdentity_('admin', userId),
      chatHash: hashTelegramConfirmationIdentity_('chat', chatId),
      messageId: messageId === null || messageId === undefined ? '' : String(messageId),
      payloadHash: hashTelegramConfirmationValue_(canonicalTelegramConfirmationJson_({action: String(action), payload: immutable})),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + DMS_TELEGRAM_CONFIRMATION.TTL_SECONDS * 1000).toISOString(),
      status: 'pending',
      operationId: 'TGOP-' + hashTelegramConfirmationHex_(String(action) + '|' + (flowMaterial || json) + '|' +
        hashTelegramConfirmationIdentity_('admin', userId) + '|' + hashTelegramConfirmationIdentity_('chat', chatId)).substring(0, 24)
    };
    appendTelegramOperationEvent_(state, 'ticket', '', '', 'immutable_payload', immutable);
    return {id: id, nonce: nonce, callbackData: 'cf2:' + id + ':' + nonce, cancelData: 'cx2:' + id + ':' + nonce};
  });
}

function parseTelegramConfirmationCallback_(data) {
  const match = String(data || '').match(/^(cf2|cx2):([a-f0-9]{16}):([a-f0-9]{32})$/);
  if (!match) throw new Error('Старая кнопка недействительна. Открой действие заново.');
  return {kind: match[1], id: match[2], nonce: match[3]};
}

function validateTelegramConfirmation_(parsed, query, nowMs) {
  const state = getTelegramConfirmationState_(parsed.id);
  const message = query.message || {}; const userId = query.from && query.from.id;
  const chatId = message.chat && message.chat.id;
  if (!isTelegramAdmin_(userId, chatId)) throw new Error('Нет доступа.');
  if (!state || state.version !== 'cf2' ||
      state.nonceHash !== hashTelegramConfirmationValue_(getTelegramConfirmationSalt_() + '|nonce|' + parsed.nonce) ||
      state.adminHash !== hashTelegramConfirmationIdentity_('admin', userId) ||
      state.chatHash !== hashTelegramConfirmationIdentity_('chat', chatId) ||
      !state.messageId || state.messageId !== String(message.message_id)) throw new Error('Confirmation identity differs.');
  const payload = getTelegramConfirmationPayload_(state.id);
  if (state.payloadHash !== hashTelegramConfirmationValue_(canonicalTelegramConfirmationJson_({action: state.action, payload: payload}))) {
    throw new Error('Confirmation payload differs.');
  }
  const now = Number(nowMs === undefined ? Date.now() : nowMs);
  if (!Number.isFinite(now) || !Number.isFinite(new Date(state.expiresAt).getTime())) {
    throw new Error('Confirmation expiry invalid.');
  }
  const previous = findTelegramOperationResult_(state.operationId);
  if (!previous && now >= new Date(state.expiresAt).getTime()) {
    state.status = 'expired'; putTelegramConfirmationState_(state);
    throw new Error('Срок подтверждения истёк.');
  }
  return {state: state, payload: payload, userId: userId, chatId: chatId, messageId: message.message_id};
}

function findTelegramOperationResult_(id) {
  const rows = getDmsOperationEvents_(3, id);
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (['pending', 'started', 'result', 'committed', 'failed', 'manual_review'].indexOf(row[4]) === -1) continue;
    if (row[13] !== 'cf2') return {status: 'manual_review', code: 'legacy_operation', recoverable: false};
    return {status: String(row[4]), code: String(row[10] || row[4]),
      at: new Date(row[1]).getTime(), result: row[16] ? JSON.parse(row[16]) : null};
  }
  return null;
}

function beginTelegramSecureOperation_(parsed, query, nowMs) {
  const context = validateTelegramConfirmation_(parsed, query, nowMs);
  const previous = findTelegramOperationResult_(context.state.operationId);
  if (previous) return {validated: context, previous: previous};
  if (context.state.status !== 'pending') throw new Error('Подтверждение отозвано или завершено.');
  appendTelegramOperationEvent_(context.state, 'pending', '', '', 'accepted');
  return {validated: context, previous: {status: 'pending'}};
}

function processTelegramSecureCallback_(query, parsed) {
  const result = withTelegramDocumentLock_(function() {
    const started = beginTelegramSecureOperation_(parsed, query);
    const context = started.validated; const previous = started.previous;
    if (previous.status === 'committed' || previous.status === 'result') {
      if (!previous.result) throw new Error('Durable result missing.');
      if (previous.status === 'result') {
        context.state.status = 'consumed';
        appendTelegramOperationEvent_(context.state, 'committed', previous.result.code, '', 'finalized', null, previous.result);
      }
      return previous.result;
    }
    if (previous.status === 'manual_review' || previous.status === 'failed') return previous;
    if (previous.status === 'started') {
      // No blind replay after a durable mutation intent, even if the process died
      // before the business service answered. Reconcile only positively identified effects.
      let recovered = null;
      try { recovered = recoverTelegramSecureMutation_(context); } catch (ignore) {}
      if (recovered) {
        context.state.status = 'consumed';
        appendTelegramOperationEvent_(context.state, 'committed', recovered.code, recovered.ref, 'reconciled', null, recovered);
        return recovered;
      }
      const unknown = {status: 'manual_review', code: 'mutation_outcome_unknown',
        stale: Date.now() - previous.at >= DMS_OPERATION_V2.STALE_MS};
      appendTelegramOperationEvent_(context.state, 'manual_review', unknown.code, '', 'no_repeat', null, unknown);
      return unknown;
    }
    if (previous.status !== 'pending') throw new Error('Unknown operation lifecycle.');
    if (context.payload.expectedBusinessHash !== getDmsConfirmedBusinessHash_()) {
      const rejected = {status: 'failed', code: 'underlying_state_changed'};
      appendTelegramOperationEvent_(context.state, 'failed', rejected.code, '', 'no_mutation', null, rejected);
      return rejected;
    }
    assertDmsConfirmedCalendarCurrent_(context.payload);
    appendTelegramOperationEvent_(context.state, 'started', '', '', 'mutation_intent');
    DMS_CONFIRMED_EXECUTION = context;
    let applied;
    try {
      applied = executeTelegramSecureMutation_(context) || {code: 'completed'};
      SpreadsheetApp.flush();
    } catch (error) {
      // The durable started marker survives both thrown errors and process death.
      // A subsequent callback reconciles it; do not claim rollback or completion.
      throw error;
    } finally { DMS_CONFIRMED_EXECUTION = null; }
    appendTelegramOperationEvent_(context.state, 'result', applied.code, applied.ref, 'business_complete', null, applied);
    context.state.status = 'consumed';
    appendTelegramOperationEvent_(context.state, 'committed', applied.code, applied.ref, 'finalized', null, applied);
    return applied;
  });
  const acknowledgement = result.status === 'manual_review' ? 'Требуется ручная сверка' :
    result.status === 'failed' ? 'Действие отклонено' : result.code === 'day_partial' ? 'День обработан частично' : 'Готово';
  telegramAnswerCallback_(query.id, acknowledgement, false);
  return result;
}
