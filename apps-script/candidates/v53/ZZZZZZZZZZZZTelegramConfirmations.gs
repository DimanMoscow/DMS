// DMS Telegram one-time confirmation and idempotency extension v50.
const DMS_TELEGRAM_CONFIRMATION = {
  VERSION: 'cf1',
  CANCEL_VERSION: 'cx1',
  PROPERTY_PREFIX: 'DMS_TG_CF_',
  PAYLOAD_PREFIX: 'DMS_TG_CF_PAYLOAD_',
  SALT_PROPERTY: 'DMS_TG_CONFIRMATION_SALT',
  LEDGER: 'Журнал операций Telegram',
  LEDGER_HEADERS: [
    'Event ID', 'At', 'Operation ID', 'Confirmation ID', 'Event', 'Action',
    'Admin Hash', 'Chat Hash', 'Message ID', 'Payload Hash', 'Result Code',
    'Result Ref Hash', 'Detail'
  ],
  TTL_SECONDS: 900
};

var DMS_TELEGRAM_SECURE_DELIVERY = false;

function telegramSendMessage_(chatId, text, replyMarkup) {
  try {
    return telegramSendMessageV49_(chatId, text, replyMarkup);
  } catch (error) {
    if (DMS_TELEGRAM_SECURE_DELIVERY) return null;
    throw error;
  }
}

function telegramEditMessage_(chatId, messageId, text, replyMarkup) {
  try {
    return telegramEditMessageV49_(chatId, messageId, text, replyMarkup);
  } catch (error) {
    if (DMS_TELEGRAM_SECURE_DELIVERY) return null;
    throw error;
  }
}

function canonicalizeTelegramConfirmationValue_(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map(function(item) {
      return canonicalizeTelegramConfirmationValue_(item);
    });
  }
  if (typeof value === 'object') {
    const result = {};
    Object.keys(value).sort().forEach(function(key) {
      if (key !== 'secureOperationId' && key !== 'secureMessageId') {
        result[key] = canonicalizeTelegramConfirmationValue_(value[key]);
      }
    });
    return result;
  }
  if (typeof value === 'number' && !isFinite(value)) throw new Error('Некорректные данные подтверждения.');
  return value;
}

function canonicalTelegramConfirmationJson_(value) {
  return JSON.stringify(canonicalizeTelegramConfirmationValue_(value));
}

function hashTelegramConfirmationValue_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function getTelegramConfirmationSalt_() {
  const properties = PropertiesService.getScriptProperties();
  let salt = String(properties.getProperty(DMS_TELEGRAM_CONFIRMATION.SALT_PROPERTY) || '');
  if (!salt) {
    salt = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    properties.setProperty(DMS_TELEGRAM_CONFIRMATION.SALT_PROPERTY, salt);
  }
  return salt;
}

function hashTelegramConfirmationIdentity_(kind, value) {
  return hashTelegramConfirmationValue_(getTelegramConfirmationSalt_() + '|' + kind + '|' + String(value));
}

function makeTelegramConfirmationId_() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 16);
}

function makeTelegramConfirmationNonce_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function makeTelegramSecureFlowId_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function ensureTelegramSecureFlowId_(state) {
  if (state && !state.secureFlowId) state.secureFlowId = makeTelegramSecureFlowId_();
  return state;
}

function hashTelegramConfirmationHex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(byte) {
    return (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0');
  }).join('');
}

function getTelegramConfirmationProperties_() {
  const properties = PropertiesService.getDocumentProperties();
  if (!properties) throw new Error('Хранилище защищённых подтверждений недоступно.');
  return properties;
}

function getTelegramConfirmationState_LegacyV50_(confirmationId) {
  const raw = getTelegramConfirmationProperties_().getProperty(
    DMS_TELEGRAM_CONFIRMATION.PROPERTY_PREFIX + String(confirmationId || '')
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (ignore) {
    return null;
  }
}

function putTelegramConfirmationState_LegacyV50_(state) {
  getTelegramConfirmationProperties_().setProperty(
    DMS_TELEGRAM_CONFIRMATION.PROPERTY_PREFIX + state.id,
    JSON.stringify(state)
  );
}

function putTelegramConfirmationPayload_(confirmationId, payload) {
  CacheService.getScriptCache().put(
    DMS_TELEGRAM_CONFIRMATION.PAYLOAD_PREFIX + confirmationId,
    canonicalTelegramConfirmationJson_(payload),
    DMS_TELEGRAM_CONFIRMATION.TTL_SECONDS
  );
}

function getTelegramConfirmationPayload_LegacyV50_(confirmationId) {
  const raw = CacheService.getScriptCache().get(
    DMS_TELEGRAM_CONFIRMATION.PAYLOAD_PREFIX + confirmationId
  );
  if (!raw) throw new Error('Данные подтверждения истекли. Открой действие заново.');
  return JSON.parse(raw);
}

function createTelegramConfirmation_LegacyV50_(userId, chatId, messageId, action, payload, nowMs) {
  const now = Number(nowMs === undefined ? Date.now() : nowMs);
  const id = makeTelegramConfirmationId_();
  const nonce = makeTelegramConfirmationNonce_();
  const payloadJson = canonicalTelegramConfirmationJson_(payload);
  const state = {
    id: id,
    nonceHash: hashTelegramConfirmationValue_(getTelegramConfirmationSalt_() + '|nonce|' + nonce),
    adminHash: hashTelegramConfirmationIdentity_('admin', userId),
    chatHash: hashTelegramConfirmationIdentity_('chat', chatId),
    messageId: messageId === null || messageId === undefined ? '' : String(messageId),
    action: String(action || ''),
    payloadHash: hashTelegramConfirmationValue_(canonicalTelegramConfirmationJson_({
      action: String(action || ''), payload: JSON.parse(payloadJson)
    })),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DMS_TELEGRAM_CONFIRMATION.TTL_SECONDS * 1000).toISOString(),
    status: 'pending',
    operationId: 'TGOP-' + hashTelegramConfirmationHex_(
      String(action || '') + '|' + hashTelegramConfirmationValue_(payloadJson) + '|' +
      hashTelegramConfirmationIdentity_('admin', userId) + '|' +
      hashTelegramConfirmationIdentity_('chat', chatId)
    ).substring(0, 24)
  };
  putTelegramConfirmationPayload_(id, payload);
  putTelegramConfirmationState_(state);
  return {
    id: id,
    nonce: nonce,
    callbackData: DMS_TELEGRAM_CONFIRMATION.VERSION + ':' + id + ':' + nonce,
    cancelData: DMS_TELEGRAM_CONFIRMATION.CANCEL_VERSION + ':' + id + ':' + nonce
  };
}

function bindTelegramConfirmationMessage_(confirmationId, messageId) {
  return withTelegramDocumentLock_(function() {
    const state = getTelegramConfirmationState_(confirmationId);
    if (!state || state.status !== 'pending' || state.messageId || findTelegramOperationResult_(state.operationId)) {
      throw new Error('Подтверждение больше не активно.');
    }
    state.messageId = String(messageId);
    putTelegramConfirmationState_(state);
  });
}

function sendTelegramSecureConfirmation_(userId, chatId, messageId, text, action, payload, buttonText) {
  const ticket = createTelegramConfirmation_(userId, chatId, messageId, action, payload);
  const markup = {inline_keyboard: [[
    {text: buttonText || '✅ Подтвердить', callback_data: ticket.callbackData},
    {text: '❌ Отмена', callback_data: ticket.cancelData}
  ]]};
  if (messageId) {
    telegramEditMessage_(chatId, messageId, text, markup);
  } else {
    const sent = telegramSendMessage_(chatId, text, markup);
    if (!sent || sent.message_id === undefined) {
      revokeTelegramConfirmationById_(ticket.id, 'message_not_bound');
      throw new Error('Не удалось привязать защищённое подтверждение к сообщению.');
    }
    bindTelegramConfirmationMessage_(ticket.id, sent.message_id);
  }
  return ticket.id;
}

function parseTelegramConfirmationCallback_LegacyV50_(data) {
  const match = String(data || '').match(/^(cf1|cx1):([a-f0-9]{16}):([a-f0-9]{32})$/);
  if (!match) throw new Error('Некорректное защищённое подтверждение.');
  return {kind: match[1], id: match[2], nonce: match[3]};
}

function assertTelegramConfirmationPayloadCurrent_(payload, userId, chatId) {
  if (!payload.stateKind) return;
  let current;
  if (payload.stateKind === 'payment') current = getTelegramPaymentState_(userId, chatId);
  else if (payload.stateKind === 'schedule') current = getTelegramScheduleState_(userId, chatId);
  else if (payload.stateKind === 'management') current = getTelegramManagementState_(userId, chatId);
  else if (payload.stateKind === 'ops') current = getTelegramOpsState_(userId, chatId);
  else if (payload.stateKind === 'move') current = getTelegramMoveState_(userId, chatId);
  else throw new Error('Неизвестный тип состояния подтверждения.');
  if (!current || hashTelegramConfirmationValue_(canonicalTelegramConfirmationJson_(current)) !== payload.stateHash) {
    throw new Error('Данные действия изменились. Открой подтверждение заново.');
  }
}

function validateTelegramConfirmation_LegacyV50_(parsed, query, nowMs) {
  const state = getTelegramConfirmationState_(parsed.id);
  const message = query.message || {};
  const chatId = message.chat && message.chat.id;
  const userId = query.from && query.from.id;
  if (!state) throw new Error('Подтверждение не найдено или истекло.');
  if (state.nonceHash !== hashTelegramConfirmationValue_(getTelegramConfirmationSalt_() + '|nonce|' + parsed.nonce)) {
    throw new Error('Подтверждение не найдено или истекло.');
  }
  if (state.adminHash !== hashTelegramConfirmationIdentity_('admin', userId)) throw new Error('Подтверждение выдано другому администратору.');
  if (state.chatHash !== hashTelegramConfirmationIdentity_('chat', chatId)) throw new Error('Подтверждение выдано для другого чата.');
  if (!state.messageId || state.messageId !== String(message.message_id)) throw new Error('Подтверждение привязано к другому сообщению.');
  const now = Number(nowMs === undefined ? Date.now() : nowMs);
  if (state.status === 'pending' && now > new Date(state.expiresAt).getTime()) {
    if (state.status === 'pending') {
      state.status = 'expired';
      putTelegramConfirmationState_(state);
      appendTelegramOperationEvent_(state, 'expired', '', '', 'ttl');
    }
    throw new Error('Срок подтверждения истёк. Открой действие заново.');
  }
  let payload = null;
  if (state.status === 'pending') {
    payload = getTelegramConfirmationPayload_(state.id);
    if (hashTelegramConfirmationValue_(canonicalTelegramConfirmationJson_({
      action: state.action, payload: payload
    })) !== state.payloadHash) {
      throw new Error('Данные подтверждения повреждены.');
    }
    assertTelegramConfirmationPayloadCurrent_(payload, userId, chatId);
  }
  return {state: state, payload: payload, userId: userId, chatId: chatId, messageId: message.message_id};
}

function getTelegramOperationLedger_LegacyV50_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(DMS_TELEGRAM_CONFIRMATION.LEDGER);
  if (!sheet) throw new Error('Не применена схема журнала защищённых операций.');
  const headers = sheet.getRange(1, 1, 1, DMS_TELEGRAM_CONFIRMATION.LEDGER_HEADERS.length).getDisplayValues()[0];
  if (canonicalTelegramConfirmationJson_(headers) !== canonicalTelegramConfirmationJson_(DMS_TELEGRAM_CONFIRMATION.LEDGER_HEADERS)) {
    throw new Error('Схема журнала защищённых операций не совпадает с контрактом.');
  }
  return sheet;
}

function appendTelegramOperationEvent_LegacyV50_(state, event, resultCode, resultRef, detail) {
  const sheet = getTelegramOperationLedger_();
  const now = new Date();
  sheet.appendRow([
    'TGE-' + Utilities.getUuid(), now, state.operationId, state.id, event, state.action,
    state.adminHash, state.chatHash, state.messageId, state.payloadHash,
    String(resultCode || ''), resultRef ? hashTelegramConfirmationValue_(String(resultRef)) : '',
    String(detail || '').substring(0, 160)
  ]);
  SpreadsheetApp.flush();
}

function findTelegramOperationResult_LegacyV50_(operationId) {
  const sheet = getTelegramOperationLedger_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const matches = sheet.getRange(2, 3, lastRow - 1, 1)
    .createTextFinder(String(operationId)).matchEntireCell(true).findAll();
  for (let index = matches.length - 1; index >= 0; index--) {
    const row = matches[index].getRow();
    const values = sheet.getRange(row, 1, 1, DMS_TELEGRAM_CONFIRMATION.LEDGER_HEADERS.length).getDisplayValues()[0];
    if (values[4] === 'committed') return {status: 'committed', code: values[10] || 'completed', refHash: values[11] || ''};
    if (values[4] === 'failed') return {status: 'failed', failed: true};
    if (values[4] === 'pending') return {status: 'pending', pending: true};
  }
  return null;
}

function revokeTelegramConfirmationById_(confirmationId, detail) {
  return withTelegramDocumentLock_(function() {
    const state = getTelegramConfirmationState_(confirmationId);
    if (!state || state.status !== 'pending' || findTelegramOperationResult_(state.operationId)) return false;
    state.status = 'revoked';
    putTelegramConfirmationState_(state);
    appendTelegramOperationEvent_(state, 'revoked', '', '', detail || 'cancel');
    return true;
  });
}

function beginTelegramSecureOperation_LegacyV50_(parsed, query, nowMs) {
  const validated = validateTelegramConfirmation_(parsed, query, nowMs);
  const state = validated.state;
  const previous = findTelegramOperationResult_(state.operationId);
  if (previous && previous.status === 'committed') {
    if (state.status === 'pending') {
      state.status = 'consumed';
      putTelegramConfirmationState_(state);
    }
    return {replay: true, result: previous, validated: validated};
  }
  if (previous && previous.pending) {
    if (state.status === 'pending') {
      state.status = 'consumed';
      putTelegramConfirmationState_(state);
    }
    return {inProgress: true, validated: validated};
  }
  if (previous && previous.failed) throw new Error('Операция требует ручной сверки и не будет повторена.');
  if (state.status !== 'pending') {
    throw new Error('Подтверждение уже использовано или отозвано.');
  }
  appendTelegramOperationEvent_(state, 'pending', '', '', 'accepted');
  state.status = 'consumed';
  state.consumedAt = new Date(Number(nowMs === undefined ? Date.now() : nowMs)).toISOString();
  putTelegramConfirmationState_(state);
  return {execute: true, validated: validated};
}

function finalizeTelegramSecureOperation_(state, result, event, detail) {
  const normalized = result || {code: 'completed'};
  appendTelegramOperationEvent_(
    state,
    event || 'committed',
    normalized.code || 'completed',
    normalized.ref || '',
    detail || ''
  );
  return normalized;
}

function withTelegramDocumentLock_LegacyV50_(callback) {
  const lock = getDmsMutationLock_();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  try { return callback(); } finally { lock.releaseLock(); }
}

function handleTelegramSecureCancellation_(query, parsed) {
  let validated;
  withTelegramDocumentLock_(function() {
    validated = validateTelegramConfirmation_(parsed, query);
    if (findTelegramOperationResult_(validated.state.operationId)) throw new Error('Операция уже принята.');
    if (validated.state.status !== 'pending') throw new Error('Подтверждение уже завершено.');
    validated.state.status = 'revoked';
    putTelegramConfirmationState_(validated.state);
    appendTelegramOperationEvent_(validated.state, 'revoked', '', '', 'admin_cancel');
  });
  clearTelegramConfirmationSourceState_(validated.payload, validated.userId, validated.chatId);
  telegramAnswerCallback_(query.id, 'Действие отменено', false);
  telegramEditMessage_(query.message.chat.id, query.message.message_id, 'Действие отменено.', null);
}

function clearTelegramConfirmationSourceState_(payload, userId, chatId) {
  if (!payload || !payload.stateKind) return;
  if (payload.stateKind === 'payment') clearTelegramPaymentState_(userId, chatId);
  else if (payload.stateKind === 'schedule') clearTelegramScheduleState_(userId, chatId);
  else if (payload.stateKind === 'management') clearTelegramManagementState_(userId, chatId);
  else if (payload.stateKind === 'ops') clearTelegramOpsState_(userId, chatId);
  else if (payload.stateKind === 'move') clearTelegramMoveState_(userId, chatId);
}

function attachTelegramSecureOperationId_(payload, userId, chatId, operationId) {
  if (!payload.stateKind) return;
  let state;
  let put;
  if (payload.stateKind === 'payment') { state = getTelegramPaymentState_(userId, chatId); put = putTelegramPaymentState_; }
  else if (payload.stateKind === 'schedule') { state = getTelegramScheduleState_(userId, chatId); put = putTelegramScheduleState_; }
  else if (payload.stateKind === 'management') { state = getTelegramManagementState_(userId, chatId); put = putTelegramManagementState_; }
  else if (payload.stateKind === 'ops') { state = getTelegramOpsState_(userId, chatId); put = putTelegramOpsState_; }
  else if (payload.stateKind === 'move') {
    state = getTelegramMoveState_(userId, chatId);
    put = function(uid, cid, next) {
      CacheService.getScriptCache().put(makeTelegramMoveCacheKey_(uid, cid), JSON.stringify(next), DMS_TELEGRAM_CALENDAR.MOVE_TTL_SECONDS);
    };
  }
  if (state && put) {
    state.secureOperationId = operationId;
    put(userId, chatId, state);
  }
}

function executeTelegramSecureMutation_(context) {
  if (DMS_CONFIRMED_EXECUTION !== context || !DMS_MUTATION_DEPTH) throw new Error('Confirmed execution lock required.');
  const data = String(context.payload.legacyData || '');
  const userId = context.userId;
  const chatId = context.chatId;
  const messageId = context.messageId;
  const operationId = context.state.operationId;
  // Mutation parameters come only from the execution-local immutable context.
  DMS_TELEGRAM_SECURE_DELIVERY = true;
  try {
    if (data === 'pc:yes') return {code: 'payment_recorded', ref: confirmTelegramPayment_(userId, chatId, messageId)};
    if (data === 'scc:yes' || data === 'scc:force') return {code: 'calendar_created', ref: confirmTelegramSchedule_(userId, chatId, messageId, data === 'scc:force')};
    if (data === 'mc:yes') { confirmTelegramManagementState_(userId, chatId, messageId); return {code: 'management_saved'}; }
    if (data === 'ops:renameYes') { confirmTelegramRenameClient_(userId, chatId, messageId); return {code: 'client_renamed'}; }
    if (data === 'ops:singlePriceYes') { confirmTelegramSinglePrice_(userId, chatId, messageId); return {code: 'single_price_saved'}; }
    if (data === 'ops:blockEditYes') { confirmTelegramBlockEdit_(userId, chatId, messageId); return {code: 'block_saved'}; }
    if (data === 'ops:umYes') { confirmTelegramUpcomingMove_(userId, chatId, messageId); return {code: 'calendar_moved'}; }
    if (data === 'ops:ucYes') { confirmTelegramUpcomingCancellation_(userId, chatId, messageId); return {code: 'calendar_cancelled'}; }
    if (data === '__secure:queueMove') { return performTelegramQueueMoveSecure_(userId, chatId, messageId, operationId); }
    if (data.indexOf('qd:') === 0) return performTelegramQueueDecisionSecure_(data, userId, chatId, messageId, operationId);
    if (data.indexOf('qp:') === 0) return performTelegramDayConfirmationSecure_(data.substring(3), chatId, messageId, operationId);
    if (data.indexOf('mgc:') === 0) { confirmTelegramGift_(chatId, data.substring(4), messageId); return {code: 'gift_added'}; }
    if (data.indexOf('mpc:') === 0) { confirmTelegramBlockStatus_(chatId, data.substring(4), 'pause', messageId); return {code: 'block_paused'}; }
    if (data.indexOf('mrc:') === 0) { confirmTelegramBlockStatus_(chatId, data.substring(4), 'resume', messageId); return {code: 'block_resumed'}; }
    if (data.indexOf('mclc:') === 0) { confirmTelegramBlockStatus_(chatId, data.substring(5), 'close', messageId); return {code: 'block_closed'}; }
    if (data.indexOf('ops:undoYes:') === 0) { performTelegramUndo_(data.substring(12)); return {code: 'undo_completed'}; }
    if (data.indexOf('ops:archiveYes:') === 0) { confirmTelegramArchiveClient_(chatId, data.substring(15), messageId); return {code: 'client_archived'}; }
    if (data.indexOf('ops:restoreYes:') === 0) { confirmTelegramRestoreClient_(chatId, data.substring(15), messageId); return {code: 'client_restored'}; }
    if (data.indexOf('ops:voidPaymentYes:') === 0) { confirmTelegramVoidPayment_(chatId, data.substring(19), messageId); return {code: 'payment_voided'}; }
    if (data.indexOf('ops:toggle:') === 0) { toggleTelegramSetting_(data.substring(11)); return {code: 'setting_changed'}; }
    if (data === 'ops:backup') return {code: 'internal_backup_created', ref: createTelegramDataBackup()};
    throw new Error('Неизвестное защищённое действие.');
  } finally {
    DMS_TELEGRAM_SECURE_DELIVERY = false;
  }
}

function performTelegramQueueDecisionSecure_(data, userId, chatId, messageId, operationId) {
  const parts = data.split(':');
  const result = setTelegramQueueDecision_(parts[1], parts[2]);
  markTelegramQueueOperation_(result.queueId, operationId);
  if (parts[2] === 'move') startTelegramMove_(userId, chatId, messageId, result);
  else refreshTelegramQueueMessage_(chatId, messageId, result.date);
  return {code: parts[2] === 'move' ? 'queue_move_started' : 'queue_decision_saved', ref: result.queueId};
}

function markTelegramQueueOperation_(queueId, operationId) {
  const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM.QUEUE);
  const row = findRowByValue_(sheet, 1, queueId, DMS_TELEGRAM.QUEUE_FIRST_ROW);
  if (!row) throw new Error('Строка очереди не найдена после изменения.');
  const range = sheet.getRange(row, 17);
  range.setValue(mergeQueueComment_(range.getValue(), '[tgop:' + operationId + ']'));
}

function performTelegramDayConfirmationSecure_(dateKey, chatId, messageId, operationId) {
  // The accepted queue is immutable for this execution. A sync here could add
  // trainings that were never included in the confirmed operation.
  const date = parseTelegramDateKey_(dateKey);
  activateStartedPlannedBlocksForDate_(date);
  const result = processQueueDate_(date, 'Telegram', false);
  const calendarResult = applyTelegramCalendarCancellationsForDate_(date);
  const incomplete = Number(result.blocked || 0) + Number(calendarResult.failed || 0) > 0;
  telegramAuditAction_('confirm_day', dateKey,
    (incomplete ? 'День обработан частично' : 'День подтверждён') + ' через Telegram [' + operationId + ']', null);
  telegramEditMessage_(chatId, messageId,
    buildTelegramDayConfirmationText_(date, result, calendarResult) + buildTelegramWarningsText_(), null);
  return {code: incomplete ? 'day_partial' : 'day_confirmed', ref: dateKey,
    added: result.added, blocked: result.blocked, calendarFailed: calendarResult.failed || 0};
}

function recoverTelegramSecureMutation_(context) {
  const data = String(context.payload.legacyData || '');
  const operationId = context.state.operationId;
  if (data === 'pc:yes') {
    const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM_FINAL.PAYMENTS);
    const lastRow = sheet.getLastRow();
    if (lastRow >= 4) {
      const rows = sheet.getRange(4, 1, lastRow - 3, 10).getValues().filter(function(row) {
        return String(row[9] || '').indexOf('[tgop:' + operationId + ']') !== -1;
      });
      const expected = context.payload.state;
      if (rows.length === 1 && expected && rows[0][0] &&
          String(rows[0][2]) === String(expected.clientId) && String(rows[0][3]) === String(expected.blockId || '') &&
          rows[0][4] === 'Оплата' && rows[0][5] === expected.method &&
          Number(rows[0][6]) === Number(expected.amount) && rows[0][7] === 'Подтверждён') {
        return {code: 'payment_recorded', ref: String(rows[0][0])};
      }
    }
  }
  if (data === 'scc:yes' || data === 'scc:force') {
    const state = context.payload.state;
    const settings = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM_SCHEDULING.SETTINGS);
    const config = getCalendarSyncSettings_(settings);
    const response = Calendar.Events.list(config.calendarId, {
      privateExtendedProperty: 'dmsOperationId=' + operationId,
      maxResults: 2,
      showDeleted: false
    });
    if (state && response.items && response.items.length === 1) {
      const event = response.items[0];
      if (event.id === 'dms' + hashTelegramConfirmationHex_(operationId) && event.status !== 'cancelled' &&
          event.summary === state.calendarTitle &&
          new Date(event.start && event.start.dateTime).getTime() === Number(state.startMs) &&
          new Date(event.end && event.end.dateTime).getTime() === Number(state.startMs) + Number(state.duration) * 60000) {
        return {code: 'calendar_created', ref: event.id};
      }
    }
  }
  if (data.indexOf('qd:') === 0) {
    const parts = data.split(':');
    const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM.QUEUE);
    const row = findRowByValue_(sheet, 1, parts[1], DMS_TELEGRAM.QUEUE_FIRST_ROW);
    if (row && String(sheet.getRange(row, 17).getDisplayValue()).indexOf('[tgop:' + operationId + ']') !== -1) {
      return {code: 'queue_decision_saved', ref: parts[1]};
    }
  }
  return null;
}

function processTelegramSecureCallback_LegacyV50_(query, parsed) {
  let started;
  started = withTelegramDocumentLock_(function() {
    return beginTelegramSecureOperation_(parsed, query);
  });
  if (started.replay) {
    withTelegramDocumentLock_(function() {
      appendTelegramOperationEvent_(started.validated.state, 'replay', started.result.code, '', 'durable_result');
    });
    telegramAnswerCallback_(query.id, 'Операция уже выполнена', false);
    telegramEditMessage_(started.validated.chatId, started.validated.messageId,
      'Операция уже выполнена. Повторная запись не создавалась.', null);
    return started.result;
  }
  if (started.inProgress) {
    telegramAnswerCallback_(query.id, 'Операция уже выполняется', true);
    return {pending: true};
  }
  const context = started.validated;
  let result;
  try {
    result = executeTelegramSecureMutation_(context);
  } catch (error) {
    let recovered = null;
    try { recovered = recoverTelegramSecureMutation_(context); } catch (ignore) {}
    withTelegramDocumentLock_(function() {
      finalizeTelegramSecureOperation_(context.state, recovered || {code: 'failed'}, recovered ? 'committed' : 'failed',
        recovered ? 'recovered_after_error' : 'mutation_error');
    });
    if (!recovered) throw error;
    result = recovered;
  }
  withTelegramDocumentLock_(function() {
    const latest = findTelegramOperationResult_(context.state.operationId);
    if (!latest || latest.pending) finalizeTelegramSecureOperation_(context.state, result, 'committed', 'exactly_once');
  });
  telegramAnswerCallback_(query.id, 'Готово', false);
  return result;
}

function describeTelegramLegacyMutation_(data) {
  const exactStateActions = {
    'pc:yes': 'payment', 'scc:yes': 'calendar_create', 'scc:force': 'calendar_create',
    'mc:yes': 'management', 'ops:renameYes': 'rename_client',
    'ops:singlePriceYes': 'single_price', 'ops:blockEditYes': 'block_edit',
    'ops:umYes': 'calendar_move', 'ops:ucYes': 'calendar_cancel'
  };
  if (exactStateActions[data]) return {blockedLegacyState: true, action: exactStateActions[data]};
  const patterns = [
    [/^qd:[^:]{1,32}:(done|charge|free|move)$/, 'queue_decision', '✅ Подтвердить решение'],
    [/^qp:\d{4}-\d{2}-\d{2}$/, 'confirm_day', '✅ Подтвердить день'],
    [/^mgc:[^:]{1,32}:[^:]{1,32}:\d+$/, 'gift_training', '🎁 Добавить'],
    [/^mpc:[^:]{1,32}:[^:]{1,32}$/, 'block_pause', '⏸ Приостановить'],
    [/^mrc:[^:]{1,32}:[^:]{1,32}$/, 'block_resume', '▶️ Возобновить'],
    [/^mclc:[^:]{1,32}:[^:]{1,32}$/, 'block_close', '✅ Закрыть блок'],
    [/^ops:undoYes:[^:]{1,64}$/, 'undo', '↩️ Выполнить откат'],
    [/^ops:archiveYes:[^:]{1,32}$/, 'client_archive', '🗄 В архив'],
    [/^ops:restoreYes:[^:]{1,32}$/, 'client_restore', '♻️ Восстановить'],
    [/^ops:voidPaymentYes:[^:]{1,64}$/, 'payment_void', '↩️ Отменить оплату'],
    [/^ops:toggle:[A-Za-z0-9_-]{1,40}$/, 'setting_toggle', '✅ Изменить настройку'],
    [/^ops:backup$/, 'internal_backup', '✅ Создать копию']
  ];
  for (let index = 0; index < patterns.length; index++) {
    if (patterns[index][0].test(data)) return {action: patterns[index][1], button: patterns[index][2]};
  }
  return null;
}

function upgradeTelegramLegacyMutation_(query, descriptor, data) {
  return withTelegramDocumentLock_(function() {
  const message = query.message || {};
  const chatId = message.chat && message.chat.id;
  const userId = query.from && query.from.id;
  let original = String(message.text || 'Подтверди выбранное действие.').substring(0, 3400);
  if (descriptor.action === 'confirm_day') {
    original = buildDmsExactDayConfirmationText_(data.substring(3));
  }
  sendTelegramSecureConfirmation_(userId, chatId, message.message_id,
    original + '\n\n<b>Защищённое одноразовое подтверждение</b>',
    descriptor.action, {legacyData: data, sourceMessageId: String(message.message_id)}, descriptor.button);
  telegramAnswerCallback_(query.id, 'Требуется одноразовое подтверждение', false);
  });
}

function handleTelegramCallback_(query) {
  const message = query.message || {};
  const chatId = message.chat && message.chat.id;
  const userId = query.from && query.from.id;
  if (!isTelegramAdmin_(userId, chatId)) {
    telegramAnswerCallback_(query.id, 'Нет доступа', true);
    return;
  }
  const data = String(query.data || '');
  if (/^(cf[12]|cx[12]):/.test(data)) {
    try {
      const parsed = parseTelegramConfirmationCallback_(data);
      if (parsed.kind === 'cx2') handleTelegramSecureCancellation_(query, parsed);
      else processTelegramSecureCallback_(query, parsed);
    } catch (error) {
      telegramAnswerCallback_(query.id, 'Действие отклонено', true);
      telegramEditMessage_(chatId, message.message_id,
        '<b>Подтверждение не принято</b>\n' + escapeTelegramHtml_(error.message || String(error)), null);
    }
    return;
  }
  const legacy = describeTelegramLegacyMutation_(data);
  if (legacy) {
    if (legacy.blockedLegacyState) {
      clearTelegramPendingStates_(userId, chatId);
      telegramAnswerCallback_(query.id, 'Старая кнопка недействительна', true);
      telegramEditMessage_(chatId, message.message_id,
        'Эта кнопка создана до обновления защиты. Открой действие заново.', null);
    } else {
      upgradeTelegramLegacyMutation_(query, legacy, data);
    }
    return;
  }
  handleTelegramCallbackV49_(query);
}

function makeTelegramStateConfirmationPayload_LegacyV50_(legacyData, stateKind, state) {
  return {
    legacyData: legacyData,
    stateKind: stateKind,
    stateHash: hashTelegramConfirmationValue_(canonicalTelegramConfirmationJson_(state))
  };
}

function handleTelegramPaymentAmount_(state, userId, chatId, text) {
  if (state.phase !== 'amount') {
    telegramSendMessage_(chatId, 'Сначала подтверди или отмени предыдущую оплату.', null);
    return;
  }
  const amount = parseTelegramMoney_(text);
  if (!amount || amount <= 0 || amount > 1000000) {
    telegramSendMessage_(chatId, 'Не понял сумму. Пришли число от 1 до 1 000 000, например <code>30000</code>.', null);
    return;
  }
  state.phase = 'confirm';
  state.amount = amount;
  putTelegramPaymentState_(userId, chatId, state);
  sendTelegramSecureConfirmation_(userId, chatId, null,
    '<b>Проверь оплату</b>\nКлиент: ' + escapeTelegramHtml_(state.clientName) +
    '\nБлок: ' + escapeTelegramHtml_(state.blockId) +
    '\nСумма: <b>' + escapeTelegramHtml_(formatTelegramMoney_(amount)) + '</b>' +
    '\nСпособ: ' + escapeTelegramHtml_(state.method) + '\nДата: сегодня',
    'payment', makeTelegramStateConfirmationPayload_('pc:yes', 'payment', state), '✅ Записать');
}

function setTelegramScheduleDuration_(userId, chatId, duration, messageId) {
  if ([60, 90, 120].indexOf(duration) === -1) throw new Error('Некорректная длительность.');
  const state = getRequiredTelegramScheduleState_(userId, chatId);
  if (!state.startMs) throw new Error('Сначала выбери дату и время.');
  state.duration = duration;
  state.phase = 'confirm';
  putTelegramScheduleState_(userId, chatId, state);
  const ss = SpreadsheetApp.getActive();
  const config = getCalendarSyncSettings_(getRequiredSheet_(ss, DMS_TELEGRAM_SCHEDULING.SETTINGS));
  const start = new Date(state.startMs);
  const end = new Date(start.getTime() + state.duration * 60000);
  const conflicts = listTelegramScheduleConflicts_(config.calendarId, start, end, config.timeZone);
  const lines = [
    '<b>Проверь новую тренировку</b>',
    'Клиент: ' + escapeTelegramHtml_(state.clientName),
    'Дата и время: <b>' + escapeTelegramHtml_(formatTelegramScheduleDateTime_(start, config.timeZone)) + '</b>',
    'Длительность: ' + state.duration + ' мин.'
  ];
  if (conflicts.length) {
    lines.push('', '<b>Есть пересечение:</b>');
    conflicts.forEach(function(conflict) { lines.push('• ' + escapeTelegramHtml_(conflict)); });
  } else lines.push('', 'Пересечений в календаре нет.');
  const legacyData = conflicts.length ? 'scc:force' : 'scc:yes';
  sendTelegramSecureConfirmation_(userId, chatId, messageId, lines.join('\n'), 'calendar_create',
    makeTelegramStateConfirmationPayload_(legacyData, 'schedule', state),
    conflicts.length ? '⚠️ Создать всё равно' : '✅ Создать');
}

function handleTelegramOpsInput_(state, userId, chatId, text) {
  try {
    if (state.action === 'search') {
      clearTelegramOpsState_(userId, chatId);
      sendTelegramClientSearch_(chatId, text);
    } else if (state.action === 'rename') {
      state.newName = validateTelegramClientName_(text);
      assertTelegramClientNameAvailable_(state.newName);
      state.phase = 'confirm';
      putTelegramOpsState_(userId, chatId, state);
      sendTelegramSecureConfirmation_(userId, chatId, null,
        '<b>Переименовать клиента?</b>\n' + escapeTelegramHtml_(state.oldName) + ' → <b>' +
        escapeTelegramHtml_(state.newName) + '</b>', 'rename_client',
        makeTelegramStateConfirmationPayload_('ops:renameYes', 'ops', state), '✅ Сохранить');
    } else if (state.action === 'single_price') {
      state.price = validateTelegramMoney_(text);
      state.phase = 'confirm';
      putTelegramOpsState_(userId, chatId, state);
      sendTelegramSecureConfirmation_(userId, chatId, null,
        '<b>Сохранить цену?</b>\nНовая цена: <b>' + escapeTelegramHtml_(formatTelegramMoney_(state.price)) + '</b>',
        'single_price', makeTelegramStateConfirmationPayload_('ops:singlePriceYes', 'ops', state), '✅ Сохранить');
    } else if (state.action === 'block_edit') {
      prepareTelegramBlockEditConfirmation_(state, userId, chatId, text);
    } else if (state.action === 'upcoming' && state.phase === 'move_input') {
      prepareTelegramUpcomingMoveConfirmation_(state, userId, chatId, text);
    } else throw new Error('Срок действия шага истёк. Начни заново.');
  } catch (error) {
    telegramSendMessage_(chatId, '<b>Не удалось принять данные</b>\n' +
      escapeTelegramHtml_(error.message || String(error)), buildTelegramCancelKeyboard_());
  }
}

function prepareTelegramUpcomingMoveConfirmation_(state, userId, chatId, text) {
  const item = getTelegramUpcomingStateItem_(state, state.selectedIndex);
  const event = getTelegramUpcomingLiveEvent_(state, item);
  const timeZone = getTelegramUpcomingTimeZone_();
  const oldStart = new Date(event.start.dateTime);
  const oldEnd = new Date(event.end.dateTime);
  const duration = Math.max(oldEnd.getTime() - oldStart.getTime(), 5 * 60 * 1000);
  const newStart = parseTelegramMoveDate_(text, timeZone, new Date());
  const newEnd = new Date(newStart.getTime() + duration);
  const conflicts = listTelegramUpcomingMoveConflicts_(state.calendarId, item.id, newStart, newEnd, timeZone);
  state.phase = 'move_confirm';
  state.newStartMs = newStart.getTime();
  state.confirmedCalendarEtag = event.etag;
  putTelegramOpsState_(userId, chatId, state);
  const lines = ['<b>Перенести тренировку?</b>', escapeTelegramHtml_(state.clientName),
    escapeTelegramHtml_(formatTelegramUpcomingTraining_(event, timeZone)) + ' →',
    '<b>' + escapeTelegramHtml_(Utilities.formatDate(newStart, timeZone, 'dd.MM.yyyy HH:mm') +
      '–' + Utilities.formatDate(newEnd, timeZone, 'HH:mm')) + '</b>'];
  if (conflicts.length) {
    lines.push('', '<b>⚠️ Есть пересечения:</b>');
    conflicts.slice(0, 5).forEach(function(conflict) { lines.push('• ' + escapeTelegramHtml_(conflict)); });
  }
  sendTelegramSecureConfirmation_(userId, chatId, null, lines.join('\n'), 'calendar_move',
    makeTelegramStateConfirmationPayload_('ops:umYes', 'ops', state), '✅ Перенести');
}

function showTelegramUpcomingCancelConfirmation_(userId, chatId, index, messageId) {
  const state = getTelegramUpcomingState_(userId, chatId);
  const item = getTelegramUpcomingStateItem_(state, index);
  const event = getTelegramUpcomingLiveEvent_(state, item);
  const timeZone = getTelegramUpcomingTimeZone_();
  state.phase = 'cancel_confirm';
  state.selectedIndex = index;
  state.confirmedCalendarEtag = event.etag;
  putTelegramOpsState_(userId, chatId, state);
  sendTelegramSecureConfirmation_(userId, chatId, messageId,
    '<b>Отменить тренировку без списания?</b>\n' + escapeTelegramHtml_(state.clientName) + '\n<b>' +
    escapeTelegramHtml_(formatTelegramUpcomingTraining_(event, timeZone)) + '</b>\n\n' +
    'Событие будет удалено из Google Calendar и затем исчезнет из Apple Calendar.',
    'calendar_cancel', makeTelegramStateConfirmationPayload_('ops:ucYes', 'ops', state), '🚫 Да, отменить');
}

function handleTelegramMoveInput_(state, userId, chatId, text) {
  try {
    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
    const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
    const row = findRowByValue_(queue, 1, state.queueId, DMS_TELEGRAM.QUEUE_FIRST_ROW);
    if (!row) throw new Error('Строка ' + state.queueId + ' не найдена.');
    const values = queue.getRange(row, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS).getValues()[0];
    if (String(values[13] || '') === 'Обработано') throw new Error('Событие уже обработано.');
    const newStart = parseTelegramMoveDate_(text, timeZone, new Date());
    const oldStart = values[5];
    const oldEnd = values[6];
    const durationMs = oldStart instanceof Date && oldEnd instanceof Date
      ? Math.max(oldEnd.getTime() - oldStart.getTime(), 5 * 60 * 1000) : 60 * 60 * 1000;
    state.phase = 'secure_move_confirm';
    state.newStartMs = newStart.getTime();
    state.durationMs = durationMs;
    putTelegramConfirmationMoveState_(userId, chatId, state);
    const newEnd = new Date(newStart.getTime() + durationMs);
    sendTelegramSecureConfirmation_(userId, chatId, null,
      '<b>Подтверди перенос</b>\n' + escapeTelegramHtml_(String(values[9] || values[7] || 'Клиент')) +
      '\n<b>' + escapeTelegramHtml_(Utilities.formatDate(newStart, timeZone, 'dd.MM.yyyy HH:mm') +
      '–' + Utilities.formatDate(newEnd, timeZone, 'HH:mm')) + '</b>',
      'queue_move', makeTelegramStateConfirmationPayload_('__secure:queueMove', 'move', state), '✅ Перенести');
  } catch (error) {
    telegramSendMessage_(chatId, '<b>Не удалось подготовить перенос</b>\n' +
      escapeTelegramHtml_(error.message || String(error)), null);
  }
}

function putTelegramConfirmationMoveState_(userId, chatId, state) {
  CacheService.getScriptCache().put(
    makeTelegramMoveCacheKey_(userId, chatId), JSON.stringify(state), DMS_TELEGRAM_CALENDAR.MOVE_TTL_SECONDS
  );
}

function performTelegramQueueMoveSecure_(userId, chatId, messageId, operationId) {
  const state = getTelegramMoveState_(userId, chatId);
  if (!state || state.phase !== 'secure_move_confirm') throw new Error('Сценарий переноса устарел.');
  const lock = getDmsMutationLock_();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется.');
  try {
    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
    const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
    const row = findRowByValue_(queue, 1, state.queueId, DMS_TELEGRAM.QUEUE_FIRST_ROW);
    if (!row) throw new Error('Строка очереди не найдена.');
    const values = queue.getRange(row, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS).getValues()[0];
    if (String(values[13] || '') === 'Обработано') throw new Error('Событие уже обработано.');
    const calendarId = String(values[2] || '').trim();
    const eventId = String(values[3] || '').trim();
    if (!calendarId || !eventId) throw new Error('У события отсутствует связь с Google Calendar.');
    const newStart = new Date(Number(state.newStartMs));
    const newEnd = new Date(newStart.getTime() + Number(state.durationMs));
    dmsCalendarPatch_({start: {dateTime: newStart.toISOString(), timeZone: timeZone},
      end: {dateTime: newEnd.toISOString(), timeZone: timeZone},
      extendedProperties: {private: {dmsOperationId: operationId}}},
      calendarId, eventId, {sendUpdates: 'none'});
    values[1] = newStart; values[5] = newStart; values[6] = newEnd;
    values[12] = 'Проведена'; values[13] = 'Ожидает'; values[14] = ''; values[15] = 'Telegram';
    values[16] = mergeQueueComment_(values[16], 'Событие перенесено через Telegram [tgop:' + operationId + ']');
    queue.getRange(row, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS).setValues([values]);
    clearTelegramMoveState_(userId, chatId);
    telegramEditMessage_(chatId, messageId, '<b>Тренировка перенесена</b>', null);
    return {code: 'queue_moved', ref: eventId};
  } finally { lock.releaseLock(); }
}

function showTelegramManagementConfirmation_(userId, chatId, state, messageId) {
  state.phase = 'confirm';
  putTelegramManagementState_(userId, chatId, state);
  let text = '<b>Проверь данные</b>\n';
  if (state.action === 'new_client' && state.clientType === 'single') {
    text += 'Новый клиент: <b>' + escapeTelegramHtml_(state.clientName) + '</b>\nФормат: разовые тренировки\n' +
      'Стоимость: <b>' + escapeTelegramHtml_(formatTelegramMoney_(state.singlePrice)) + '</b>\nСтатус: активен';
  } else if (state.action === 'new_client' || state.action === 'new_block') {
    const date = parseTelegramDateKey_(state.blockDateKey);
    const timeZone = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Europe/Moscow';
    text += 'Клиент: <b>' + escapeTelegramHtml_(state.clientName) + '</b>\n' +
      (state.action === 'new_client' ? 'Действие: новый клиент и новый блок\n' : 'Действие: новый блок\n') +
      'Тренировок: <b>' + state.blockCount + '</b>\nСтоимость: <b>' +
      escapeTelegramHtml_(formatTelegramMoney_(state.blockPrice)) + '</b>\nНачало: <b>' +
      Utilities.formatDate(date, timeZone, 'dd.MM.yyyy') + '</b>\nОплата: не внесена';
  } else if (state.action === 'adjust_remaining') {
    text += 'Клиент: <b>' + escapeTelegramHtml_(state.clientName) + '</b>\nБлок: ' +
      escapeTelegramHtml_(state.blockId) + '\nОстаток: <s>' + state.oldRemaining + '</s> → <b>' +
      state.newRemaining + '</b>\nРазмер блока станет: ' + state.newTotal;
  } else if (state.action === 'client_note') {
    text += 'Клиент: <b>' + escapeTelegramHtml_(state.clientName) + '</b>\nДобавить заметку:\n<i>' +
      escapeTelegramHtml_(state.note) + '</i>';
  } else throw new Error('Неизвестное действие.');
  sendTelegramSecureConfirmation_(userId, chatId, messageId, text, 'management',
    makeTelegramStateConfirmationPayload_('mc:yes', 'management', state), '✅ Сохранить');
}

function prepareTelegramBlockEditConfirmation_(state, userId, chatId, text) {
  const card = getTelegramClientCard_(state.clientId);
  if (!card.blockId || card.blockId !== state.blockId) throw new Error('Действующий блок изменился. Открой карточку заново.');
  const block = getTelegramBlockRecord_(state.blockId);
  if (!block) throw new Error('Блок не найден.');
  const timeZone = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Europe/Moscow';
  let title; let before; let after;
  if (state.field === 'total') {
    state.value = validateTelegramPositiveInteger_(text, 1, 100, 'Количество');
    if (state.value < block.completed) throw new Error('Нельзя указать меньше проведённых тренировок: ' + block.completed + '.');
    title = 'Количество тренировок'; before = String(block.total);
    after = String(state.value) + ' (остаток станет ' + (state.value - block.completed) + ')';
  } else if (state.field === 'price') {
    state.value = validateTelegramBlockPrice_(text); title = 'Стоимость блока';
    before = formatTelegramMoney_(block.price); after = formatTelegramMoney_(state.value);
  } else if (state.field === 'date') {
    const parsed = parseTelegramBlockDate_(text, timeZone, new Date());
    const todayKey = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
    const dateKey = Utilities.formatDate(parsed, timeZone, 'yyyy-MM-dd');
    if (block.completed > 0 && dateKey > todayKey) throw new Error('Нельзя перенести начатый блок в будущее.');
    state.value = parsed.getTime(); title = 'Дата начала';
    before = block.startDate instanceof Date ? Utilities.formatDate(block.startDate, timeZone, 'dd.MM.yyyy') : 'не указана';
    after = Utilities.formatDate(parsed, timeZone, 'dd.MM.yyyy');
  } else throw new Error('Неизвестный параметр блока.');
  state.phase = 'confirm';
  putTelegramOpsState_(userId, chatId, state);
  sendTelegramSecureConfirmation_(userId, chatId, null,
    '<b>Сохранить изменение?</b>\n' + escapeTelegramHtml_(title) + ':\n' + escapeTelegramHtml_(before) +
    ' → <b>' + escapeTelegramHtml_(after) + '</b>', 'block_edit',
    makeTelegramStateConfirmationPayload_('ops:blockEditYes', 'ops', state), '✅ Сохранить');
}
