// DMS Fitness Mini App administrative actions v40 candidate.
// Business operations delegate to the same queue functions used by Telegram.

function setDmsMiniAppQueueDecision_(payload) {
  const queueId = String(payload && payload.queueId || '').trim();
  const decisionCode = String(payload && payload.decision || '').trim();
  const decisions = {
    done: 'Проведена',
    charge: 'Отмена со списанием',
    free: 'Отмена без списания'
  };

  if (!/^Q-[A-Za-z0-9_-]+$/.test(queueId)) {
    throwDmsMiniAppError_('queue_not_found', 404, 'Некорректный ID очереди.');
  }
  if (!decisions[decisionCode]) {
    throwDmsMiniAppError_('invalid_decision', 400, 'Неизвестное решение очереди.');
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    throwDmsMiniAppError_('operation_busy', 409, 'Другое действие ещё выполняется.');
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
    const row = findRowByValue_(
      queue,
      1,
      queueId,
      DMS_TELEGRAM.QUEUE_FIRST_ROW
    );
    if (!row) {
      throwDmsMiniAppError_('queue_not_found', 404, 'Строка очереди не найдена.');
    }

    const values = queue.getRange(
      row,
      1,
      1,
      DMS_TELEGRAM.QUEUE_COLUMNS
    ).getValues()[0];
    const status = String(values[13] || '');
    if (status === 'Обработано') {
      throwDmsMiniAppError_('already_processed', 409, 'Событие уже обработано.');
    }

    const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
    if (!(values[1] instanceof Date) ||
        makeDateKey_(values[1], timeZone) !== makeDateKey_(new Date(), timeZone)) {
      throwDmsMiniAppError_('not_today', 409, 'Событие не относится к текущему дню.');
    }

    const decision = decisions[decisionCode];
    if (String(values[12] || '') === decision && status === 'Ожидает') {
      return {
        bootstrap: getDmsMiniAppBootstrap_(),
        mutation: {
          changed: false,
          queueId: queueId,
          notice: 'решение уже сохранено'
        }
      };
    }

    const mutation = setTelegramQueueDecision_(queueId, decisionCode);
    queue.getRange(row, 16).setValue('MiniApp');
    SpreadsheetApp.flush();

    return {
      bootstrap: getDmsMiniAppBootstrap_(),
      mutation: {
        changed: true,
        queueId: queueId,
        notice: mutation.notice
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function confirmDmsMiniAppDay_(payload) {
  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const todayKey = makeDateKey_(new Date(), timeZone);
  const dateKey = String(payload && payload.dateKey || '').trim();

  if (!dateKey || dateKey !== todayKey) {
    throwDmsMiniAppError_('not_today', 409, 'Подтвердить можно только текущий день.');
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    throwDmsMiniAppError_('operation_busy', 409, 'Другое действие ещё выполняется.');
  }

  try {
    const date = parseTelegramDateKey_(dateKey);
    const syncPlan = buildCalendarQueueSyncPlan_();
    const preflight = processQueueDate_(date, 'MiniApp', true, {
      lockHeld: true,
      projectPlannedActivations: true,
      queueRows: syncPlan.queueRows
    });

    if (preflight.blocked > 0 || (preflight.blockers || []).length > 0) {
      throwDmsMiniAppError_(
        'day_not_ready',
        409,
        (preflight.blockers || []).join('; ') || 'Не все события дня готовы.'
      );
    }

    applyCalendarQueueSyncPlan_(syncPlan);
    const result = processQueueDate_(date, 'MiniApp', false, {lockHeld: true});
    const calendarResult = applyTelegramCalendarCancellationsForDate_(date);

    if (result.blocked > 0 || (result.blockers || []).length > 0) {
      throw new Error('Инвариант preflight нарушен: обработка дня вернула блокировки.');
    }

    return {
      bootstrap: getDmsMiniAppBootstrap_(),
      confirmation: {
        changed: Boolean(result.added || result.skipped || result.alreadyLogged),
        added: Number(result.added || 0),
        skipped: Number(result.skipped || 0),
        alreadyLogged: Number(result.alreadyLogged || 0),
        calendarDeleted: Number(calendarResult.deleted || 0),
        calendarAlreadyMissing: Number(calendarResult.alreadyMissing || 0),
        calendarFailed: Number(calendarResult.failed || 0)
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function throwDmsMiniAppError_(code, status, message) {
  const error = new Error(message || code);
  error.dmsCode = code;
  error.dmsStatus = status;
  throw error;
}

function getDmsMiniAppFailure_(error) {
  if (error && error.dmsCode) {
    return {
      code: String(error.dmsCode),
      status: Number(error.dmsStatus) || 500
    };
  }

  const message = String(error && error.message || error || '');
  if (/другое действие/i.test(message)) {
    return {code: 'operation_busy', status: 409};
  }
  if (/уже обработано/i.test(message)) {
    return {code: 'already_processed', status: 409};
  }
  if (/не найдена/i.test(message)) {
    return {code: 'queue_not_found', status: 404};
  }
  return {code: 'mini_app_api_failed', status: 500};
}

function runDmsMiniAppAdminSelfTest() {
  const checks = [];
  function check(name, ok) {
    checks.push({name: name, ok: Boolean(ok)});
  }

  check('release-v38', DMS_MINI_APP_API.RELEASE === 'v38-admin-today');
  check('queue-decision-handler', typeof setDmsMiniAppQueueDecision_ === 'function');
  check('confirm-day-handler', typeof confirmDmsMiniAppDay_ === 'function');
  check('shared-queue-processor', typeof processQueueDate_ === 'function');
  check('shared-telegram-decision', typeof setTelegramQueueDecision_ === 'function');
  check('calendar-cancellation', typeof applyTelegramCalendarCancellationsForDate_ === 'function');

  const result = {
    ok: checks.every(function(item) { return item.ok; }),
    checks: checks
  };
  console.log(JSON.stringify(result));
  return result;
}

// Calendar-driven onboarding. Every mutation is admin-only at the API router,
// revalidated under the document lock, and leaves the source Calendar event intact.
const DMS_CALENDAR_ONBOARDING = {
  QUEUE: 'Очередь подтверждения',
  CLIENTS: 'Клиенты',
  BLOCKS: 'Блоки',
  PAYMENTS: 'Оплаты',
  LOG: 'Журнал тренировок',
  QUEUE_FIRST_ROW: 4,
  QUEUE_COLUMNS: 17,
  CLIENT_FIRST_ROW: 5,
  CLIENT_COLUMNS: 14,
  BLOCK_FIRST_ROW: 4,
  BLOCK_COLUMNS: 17,
  PAYMENT_FIRST_ROW: 4,
  PAYMENT_COLUMNS: 10,
  REGISTRATION_STATUS: 'Требует регистрации',
  PAYMENT_METHODS: ['Перевод', 'Наличные', 'Эквайринг', 'Другое']
};

function previewDmsCalendarOnboarding_(payload) {
  const ss = SpreadsheetApp.getActive();
  const item = getDmsCalendarOnboardingQueueItem_(ss, payload && payload.queueId);
  return buildDmsCalendarOnboardingPreview_(ss, item, payload || {});
}

function resolveDmsCalendarOnboarding_(payload, actorId) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    throwDmsMiniAppError_('operation_busy', 409, 'Другое действие ещё выполняется.');
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const item = getDmsCalendarOnboardingQueueItem_(ss, payload && payload.queueId, true);
    const preview = buildDmsCalendarOnboardingPreview_(ss, item, payload || {});
    const mode = preview.mode;

    if (mode === 'link' && item.values[11] === 'Распознано' &&
        String(item.values[8] || '') === preview.client.id) {
      return {changed: false, queueId: item.queueId, mode: mode};
    }
    if (mode === 'ignore' && item.values[11] === 'Не тренировка' &&
        item.values[13] === 'Обработано') {
      return {changed: false, queueId: item.queueId, mode: mode};
    }
    if (!isDmsCalendarOnboardingPending_(item.values)) {
      throwDmsMiniAppError_(
        'calendar_onboarding_conflict',
        409,
        'Событие уже было разрешено или изменилось.'
      );
    }

    if (mode === 'link') {
      return applyDmsCalendarOnboardingLink_(ss, item, preview, actorId);
    }
    if (mode === 'ignore') {
      return applyDmsCalendarOnboardingIgnore_(ss, item, preview, actorId);
    }
    return applyDmsCalendarOnboardingNewClient_(ss, item, preview, actorId);
  } finally {
    lock.releaseLock();
  }
}

function buildDmsCalendarOnboardingPreview_(ss, item, payload) {
  const mode = String(payload.mode || '').trim();
  if (['new', 'link', 'ignore'].indexOf(mode) === -1) {
    throwDmsMiniAppError_('calendar_onboarding_invalid', 400, 'Выбери действие.');
  }

  assertDmsCalendarOnboardingNoJournal_(ss, item);
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const base = {
    mode: mode,
    queue: {
      queueId: item.queueId,
      calendarTitle: String(item.values[7] || ''),
      start: item.values[5] instanceof Date ? item.values[5].toISOString() : '',
      end: item.values[6] instanceof Date ? item.values[6].toISOString() : ''
    },
    createsJournal: false,
    changesCalendar: false
  };

  if (mode === 'ignore') {
    base.summary = 'Игнорировать только это событие; запись календаря не удаляется.';
    return base;
  }

  if (mode === 'link') {
    const client = getDmsCalendarOnboardingClient_(ss, payload.clientId);
    assertDmsCalendarAliasAvailable_(ss, item.values[7], client.id);
    base.client = {
      id: client.id,
      name: client.name,
      blockId: client.blockId
    };
    base.summary = 'Связать событие с выбранным клиентом и сохранить название как alias.';
    return base;
  }

  const name = validateTelegramClientName_(payload.name);
  assertTelegramClientNameAvailable_(name);
  assertDmsCalendarAliasAvailable_(ss, item.values[7], '');
  const product = normalizeDmsCalendarOnboardingProduct_(payload.product, payload);
  const payment = normalizeDmsCalendarOnboardingPayment_(payload, product, timeZone);
  base.client = {name: name};
  base.product = product;
  base.payment = payment;
  base.summary = payment.paid
    ? 'Создать клиента, условия, отдельную подтверждённую оплату и связать событие.'
    : 'Создать клиента и условия без оплаты, затем связать событие.';
  return base;
}

function normalizeDmsCalendarOnboardingProduct_(productCode, payload) {
  const code = String(productCode || '').trim();
  const standard = {
    single: {format: 'Разовая', count: 0, price: 3500, support: 0},
    block5: {format: 'Блок 5', count: 5, price: 16000, support: 0},
    block10: {format: 'Блок 10', count: 10, price: 30000, support: 0}
  };
  if (standard[code]) {
    const item = standard[code];
    const requested = payload.price === '' || payload.price === undefined
      ? item.price
      : validateDmsCalendarOnboardingMoney_(payload.price, 'Цена');
    return {
      code: code,
      format: item.format,
      count: item.count,
      price: requested,
      support: item.support,
      standardPrice: item.price,
      usesStandardPrice: requested === item.price
    };
  }

  if (['hybrid', 'individual'].indexOf(code) !== -1) {
    const count = validateTelegramPositiveInteger_(
      payload.count,
      1,
      100,
      'Количество тренировок'
    );
    const price = validateDmsCalendarOnboardingMoney_(payload.price, 'Стоимость');
    const support = code === 'hybrid'
      ? validateDmsCalendarOnboardingMoney_(payload.support || 0, 'Сопровождение', true)
      : 0;
    return {
      code: code,
      format: code === 'hybrid' ? 'Гибрид' : 'Индивидуальный',
      count: count,
      price: price,
      support: support,
      standardPrice: null,
      usesStandardPrice: false
    };
  }

  throwDmsMiniAppError_('calendar_onboarding_product_invalid', 400, 'Выбери формат.');
}

function normalizeDmsCalendarOnboardingPayment_(payload, product, timeZone) {
  const paid = String(payload.paymentStatus || 'unpaid') === 'paid';
  if (!paid) return {paid: false, method: '', amount: 0, dateKey: ''};

  const method = String(payload.paymentMethod || '').trim();
  if (DMS_CALENDAR_ONBOARDING.PAYMENT_METHODS.indexOf(method) === -1) {
    throwDmsMiniAppError_(
      'calendar_onboarding_payment_invalid',
      400,
      'Выбери способ оплаты.'
    );
  }
  const amount = payload.paymentAmount === '' || payload.paymentAmount === undefined
    ? product.price
    : validateDmsCalendarOnboardingMoney_(payload.paymentAmount, 'Сумма оплаты');
  const dateKey = String(payload.paymentDate || '').trim() ||
    Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  const date = Utilities.parseDate(dateKey + ' 12:00', timeZone, 'yyyy-MM-dd HH:mm');
  if (Utilities.formatDate(date, timeZone, 'yyyy-MM-dd') !== dateKey) {
    throwDmsMiniAppError_('calendar_onboarding_payment_invalid', 400, 'Проверь дату оплаты.');
  }
  return {paid: true, method: method, amount: amount, dateKey: dateKey};
}

function validateDmsCalendarOnboardingMoney_(value, label, allowZero) {
  const number = Number(String(value).replace(/\s+/g, '').replace(',', '.'));
  const min = allowZero ? 0 : 1;
  if (!isFinite(number) || number < min || number > 1000000 ||
      Math.round(number * 100) !== number * 100) {
    throwDmsMiniAppError_(
      'calendar_onboarding_price_invalid',
      400,
      String(label || 'Сумма') + ': введи число от ' + min + ' до 1 000 000.'
    );
  }
  return number;
}

function getDmsCalendarOnboardingQueueItem_(ss, queueId, allowResolved) {
  const id = String(queueId || '').trim();
  if (!/^Q-[A-Za-z0-9_-]+$/.test(id)) {
    throwDmsMiniAppError_('queue_not_found', 404, 'Некорректный ID очереди.');
  }
  const queue = getRequiredSheet_(ss, DMS_CALENDAR_ONBOARDING.QUEUE);
  const row = findRowByValue_(
    queue,
    1,
    id,
    DMS_CALENDAR_ONBOARDING.QUEUE_FIRST_ROW
  );
  if (!row) throwDmsMiniAppError_('queue_not_found', 404, 'Событие не найдено.');
  const values = queue.getRange(
    row,
    1,
    1,
    DMS_CALENDAR_ONBOARDING.QUEUE_COLUMNS
  ).getValues()[0];
  const resolved = values[11] === 'Распознано' || values[11] === 'Не тренировка';
  if (!isDmsCalendarOnboardingPending_(values) && !(allowResolved && resolved)) {
    throwDmsMiniAppError_(
      'calendar_onboarding_conflict',
      409,
      'Событие не ожидает регистрации.'
    );
  }
  return {sheet: queue, row: row, values: values, queueId: id};
}

function isDmsCalendarOnboardingPending_(values) {
  return [DMS_CALENDAR_ONBOARDING.REGISTRATION_STATUS, 'Не распознано']
    .indexOf(String(values[11] || '')) !== -1 &&
    String(values[13] || '') !== 'Обработано';
}

function assertDmsCalendarOnboardingNoJournal_(ss, item) {
  const log = getRequiredSheet_(ss, DMS_CALENDAR_ONBOARDING.LOG);
  const lastRow = log.getLastRow();
  if (lastRow < DMS_QUEUE_PROCESSING.LOG_FIRST_ROW) return;
  const rows = log.getRange(
    DMS_QUEUE_PROCESSING.LOG_FIRST_ROW,
    1,
    lastRow - DMS_QUEUE_PROCESSING.LOG_FIRST_ROW + 1,
    DMS_QUEUE_PROCESSING.LOG_COLUMNS
  ).getValues();
  const eventId = String(item.values[3] || '');
  const duplicate = rows.some(function(row) {
    return String(row[18] || '') === item.queueId ||
      (eventId && String(row[13] || '') === eventId);
  });
  if (duplicate) {
    throwDmsMiniAppError_(
      'calendar_onboarding_conflict',
      409,
      'Событие уже присутствует в журнале.'
    );
  }
}

function getDmsCalendarOnboardingClient_(ss, clientId) {
  const id = String(clientId || '').trim();
  if (!/^CL-[A-Za-z0-9_-]+$/.test(id)) {
    throwDmsMiniAppError_('client_not_found', 404, 'Клиент не найден.');
  }
  const clients = getRequiredSheet_(ss, DMS_CALENDAR_ONBOARDING.CLIENTS);
  const row = findRowByValue_(clients, 1, id, DMS_CALENDAR_ONBOARDING.CLIENT_FIRST_ROW);
  if (!row) throwDmsMiniAppError_('client_not_found', 404, 'Клиент не найден.');
  const values = clients.getRange(row, 1, 1, 14).getValues()[0];
  if (String(values[2] || '') !== 'Активен') {
    throwDmsMiniAppError_('client_inactive', 409, 'Клиент не активен.');
  }
  return {
    id: id,
    name: String(values[1] || ''),
    blockId: String(values[3] || ''),
    row: row
  };
}

function assertDmsCalendarAliasAvailable_(ss, title, expectedClientId) {
  const key = normalizeCalendarTitle_(title);
  if (!key) throwDmsMiniAppError_('calendar_alias_invalid', 400, 'Название пустое.');
  const clients = getRequiredSheet_(ss, DMS_CALENDAR_ONBOARDING.CLIENTS);
  const lastRow = clients.getLastRow();
  if (lastRow < DMS_CALENDAR_ONBOARDING.CLIENT_FIRST_ROW) return;
  const rows = clients.getRange(
    DMS_CALENDAR_ONBOARDING.CLIENT_FIRST_ROW,
    1,
    lastRow - DMS_CALENDAR_ONBOARDING.CLIENT_FIRST_ROW + 1,
    14
  ).getValues();
  const owners = {};
  rows.forEach(function(row) {
    const clientId = String(row[0] || '').trim();
    if (!clientId) return;
    [row[12]].concat(String(row[13] || '').split(/[\n,;|]+/)).forEach(function(alias) {
      if (normalizeCalendarTitle_(alias) === key) owners[clientId] = true;
    });
  });
  const conflicts = Object.keys(owners).filter(function(clientId) {
    return clientId !== String(expectedClientId || '');
  });
  if (conflicts.length) {
    throwDmsMiniAppError_(
      'calendar_alias_conflict',
      409,
      'Это календарное название уже принадлежит другому клиенту.'
    );
  }
}

function applyDmsCalendarOnboardingLink_(ss, item, preview, actorId) {
  const clients = getRequiredSheet_(ss, DMS_CALENDAR_ONBOARDING.CLIENTS);
  const currentClient = getDmsCalendarOnboardingClient_(ss, preview.client.id);
  const aliasCell = clients.getRange(currentClient.row, 14);
  const beforeAlias = aliasCell.getValue();
  const title = String(item.values[7] || '').trim();
  const aliases = String(beforeAlias || '').split(/[\n,;|]+/).map(function(value) {
    return value.trim();
  }).filter(Boolean);
  if (!aliases.some(function(value) {
    return normalizeCalendarTitle_(value) === normalizeCalendarTitle_(title);
  })) aliases.push(title);

  const next = resolveDmsCalendarOnboardingQueueValues_(item.values, preview.client);
  try {
    aliasCell.setValue(aliases.join(', '));
    item.sheet.getRange(item.row, 1, 1, DMS_CALENDAR_ONBOARDING.QUEUE_COLUMNS)
      .setValues([next]);
    SpreadsheetApp.flush();
    const auditId = appendDmsCalendarOnboardingAudit_(
      'calendar_link_client',
      item.queueId,
      'Календарное событие связано с клиентом ' + preview.client.id,
      {
        type: 'compound',
        items: [
          makeTelegramRestoreRangeUndo_(clients, currentClient.row, 14, [[beforeAlias]]),
          makeTelegramRestoreRangeUndo_(item.sheet, item.row, 1, [item.values])
        ]
      },
      actorId
    );
    return {changed: true, queueId: item.queueId, mode: 'link', auditId: auditId};
  } catch (error) {
    aliasCell.setValue(beforeAlias);
    item.sheet.getRange(item.row, 1, 1, DMS_CALENDAR_ONBOARDING.QUEUE_COLUMNS)
      .setValues([item.values]);
    SpreadsheetApp.flush();
    throw error;
  }
}

function applyDmsCalendarOnboardingIgnore_(ss, item, preview, actorId) {
  const next = item.values.slice();
  next[11] = 'Не тренировка';
  next[12] = 'Не учитывать';
  next[13] = 'Обработано';
  next[14] = new Date();
  next[15] = 'MiniApp';
  next[16] = mergeQueueComment_(next[16], 'Игнорируется только это событие');
  try {
    item.sheet.getRange(item.row, 1, 1, DMS_CALENDAR_ONBOARDING.QUEUE_COLUMNS)
      .setValues([next]);
    SpreadsheetApp.flush();
    const auditId = appendDmsCalendarOnboardingAudit_(
      'calendar_ignore_event',
      item.queueId,
      'Календарное событие помечено не клиентской тренировкой',
      makeTelegramRestoreRangeUndo_(item.sheet, item.row, 1, [item.values]),
      actorId
    );
    return {changed: true, queueId: item.queueId, mode: 'ignore', auditId: auditId};
  } catch (error) {
    item.sheet.getRange(item.row, 1, 1, DMS_CALENDAR_ONBOARDING.QUEUE_COLUMNS)
      .setValues([item.values]);
    SpreadsheetApp.flush();
    throw error;
  }
}

function applyDmsCalendarOnboardingNewClient_(ss, item, preview, actorId) {
  const state = {
    action: 'new_client',
    clientName: preview.client.name,
    clientType: preview.product.code === 'single' ? 'single' : 'block',
    singlePrice: preview.product.price,
    blockCount: preview.product.count,
    blockPrice: preview.product.price,
    blockDateKey: Utilities.formatDate(
      item.values[5],
      ss.getSpreadsheetTimeZone() || 'Europe/Moscow',
      'yyyy-MM-dd'
    )
  };
  const clients = getRequiredSheet_(ss, DMS_CALENDAR_ONBOARDING.CLIENTS);
  const clientTargetRow = findTelegramEmptyEntityRow_(
    clients,
    DMS_CALENDAR_ONBOARDING.CLIENT_FIRST_ROW
  );
  const captures = [
    captureDmsCalendarOnboardingRange_(
      clients,
      clientTargetRow,
      1,
      DMS_CALENDAR_ONBOARDING.CLIENT_COLUMNS
    )
  ];
  if (state.clientType === 'block') {
    const blocksForCapture = getRequiredSheet_(ss, DMS_CALENDAR_ONBOARDING.BLOCKS);
    captures.push(captureDmsCalendarOnboardingRange_(
      blocksForCapture,
      findTelegramEmptyEntityRow_(blocksForCapture, DMS_CALENDAR_ONBOARDING.BLOCK_FIRST_ROW),
      1,
      DMS_CALENDAR_ONBOARDING.BLOCK_COLUMNS
    ));
  }
  if (preview.payment.paid) {
    const paymentsForCapture = getRequiredSheet_(ss, DMS_CALENDAR_ONBOARDING.PAYMENTS);
    captures.push(captureDmsCalendarOnboardingRange_(
      paymentsForCapture,
      findTelegramEmptyPaymentRow_(paymentsForCapture),
      1,
      DMS_CALENDAR_ONBOARDING.PAYMENT_COLUMNS
    ));
  }
  const queueCapture = captureDmsCalendarOnboardingRange_(
    item.sheet,
    item.row,
    1,
    DMS_CALENDAR_ONBOARDING.QUEUE_COLUMNS
  );

  try {
    const result = createTelegramClient_(state);
  const clientRow = findRowByValue_(
    clients,
    1,
    result.clientId,
    DMS_CALENDAR_ONBOARDING.CLIENT_FIRST_ROW
  );
  const clientCard = getDmsCalendarOnboardingClient_(ss, result.clientId);
  const title = String(item.values[7] || '').trim();
  const generatedTitle = String(clients.getRange(clientRow, 13).getValue() || '').trim();
  clients.getRange(clientRow, 13, 1, 2).setValues([[
    title,
    normalizeCalendarTitle_(generatedTitle) !== normalizeCalendarTitle_(title)
      ? generatedTitle
      : ''
  ]]);

  let blockRow = 0;
  if (clientCard.blockId) {
    const blocks = getRequiredSheet_(ss, DMS_CALENDAR_ONBOARDING.BLOCKS);
    blockRow = findRowByValue_(
      blocks,
      1,
      clientCard.blockId,
      DMS_CALENDAR_ONBOARDING.BLOCK_FIRST_ROW
    );
    blocks.getRange(blockRow, 3).setValue(preview.product.format);
    blocks.getRange(blockRow, 13).setValue(preview.product.support || '');
    clients.getRange(clientRow, 5).setValue(preview.product.format);
  }

  let payment = null;
  if (preview.payment.paid) {
    payment = appendDmsCalendarOnboardingPayment_(
      ss,
      result.clientId,
      clientCard.blockId,
      preview.payment
    );
  }

  const next = resolveDmsCalendarOnboardingQueueValues_(
    item.values,
    getDmsCalendarOnboardingClient_(ss, result.clientId)
  );
  item.sheet.getRange(item.row, 1, 1, DMS_CALENDAR_ONBOARDING.QUEUE_COLUMNS)
    .setValues([next]);

  const undo = [
    makeTelegramRestoreRangeUndo_(item.sheet, item.row, 1, [item.values]),
    {
      type: 'clear_range',
      sheet: clients.getName(),
      row: clientRow,
      column: 1,
      rows: 1,
      columns: DMS_CALENDAR_ONBOARDING.CLIENT_COLUMNS
    }
  ];
  if (blockRow) {
    undo.push({
      type: 'clear_range',
      sheet: DMS_CALENDAR_ONBOARDING.BLOCKS,
      row: blockRow,
      column: 1,
      rows: 1,
      columns: DMS_CALENDAR_ONBOARDING.BLOCK_COLUMNS
    });
  }
  if (payment) {
    undo.push({
      type: 'clear_range',
      sheet: DMS_CALENDAR_ONBOARDING.PAYMENTS,
      row: payment.row,
      column: 1,
      rows: 1,
      columns: DMS_CALENDAR_ONBOARDING.PAYMENT_COLUMNS
    });
  }
    SpreadsheetApp.flush();
    const auditId = appendDmsCalendarOnboardingAudit_(
    'calendar_new_client',
    item.queueId,
    'Создан клиент ' + result.clientId + ' из календарного события',
    {type: 'compound', items: undo},
    actorId
  );
    return {
      changed: true,
      queueId: item.queueId,
      mode: 'new',
      clientId: result.clientId,
      auditId: auditId
    };
  } catch (error) {
    captures.slice().reverse().forEach(restoreDmsCalendarOnboardingRange_);
    restoreDmsCalendarOnboardingRange_(queueCapture);
    SpreadsheetApp.flush();
    throw error;
  }
}

function captureDmsCalendarOnboardingRange_(sheet, row, column, columns) {
  const range = sheet.getRange(row, column, 1, columns);
  return {
    sheet: sheet,
    row: row,
    column: column,
    values: range.getValues(),
    formulas: range.getFormulas(),
    validations: range.getDataValidations()
  };
}

function restoreDmsCalendarOnboardingRange_(capture) {
  const range = capture.sheet.getRange(
    capture.row,
    capture.column,
    capture.values.length,
    capture.values[0].length
  );
  range.setValues(capture.values);
  capture.formulas.forEach(function(row, rowIndex) {
    row.forEach(function(formula, columnIndex) {
      if (formula) range.getCell(rowIndex + 1, columnIndex + 1).setFormula(formula);
    });
  });
  range.setDataValidations(capture.validations);
}

function resolveDmsCalendarOnboardingQueueValues_(values, client) {
  const next = values.slice();
  next[8] = client.id;
  next[9] = client.name;
  next[10] = client.blockId || '';
  next[11] = 'Распознано';
  next[12] = 'Проведена';
  next[13] = 'Ожидает';
  next[14] = '';
  next[15] = 'MiniApp';
  next[16] = mergeQueueComment_(next[16], 'Клиент разрешён администратором');
  return next;
}

function appendDmsCalendarOnboardingPayment_(ss, clientId, blockId, payment) {
  const sheet = getRequiredSheet_(ss, DMS_CALENDAR_ONBOARDING.PAYMENTS);
  const row = findTelegramEmptyPaymentRow_(sheet);
  const operationId = makeNextTelegramPaymentId_(sheet);
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const paidAt = Utilities.parseDate(
    payment.dateKey + ' 12:00',
    timeZone,
    'yyyy-MM-dd HH:mm'
  );
  if (sheet.getLastRow() >= DMS_CALENDAR_ONBOARDING.PAYMENT_FIRST_ROW) {
    const template = sheet.getRange(
      DMS_CALENDAR_ONBOARDING.PAYMENT_FIRST_ROW,
      1,
      1,
      DMS_CALENDAR_ONBOARDING.PAYMENT_COLUMNS
    );
    const target = sheet.getRange(
      row,
      1,
      1,
      DMS_CALENDAR_ONBOARDING.PAYMENT_COLUMNS
    );
    template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
  sheet.getRange(row, 1, 1, DMS_CALENDAR_ONBOARDING.PAYMENT_COLUMNS).setValues([[
    operationId,
    paidAt,
    clientId,
    blockId || '',
    'Оплата',
    payment.method,
    payment.amount,
    'Подтверждён',
    new Date(),
    'Создано через Calendar onboarding'
  ]]);
  return {id: operationId, row: row};
}

function appendDmsCalendarOnboardingAudit_(action, entity, description, undoPayload, actorId) {
  const sheet = getOrCreateTelegramAuditSheet_();
  const timeZone = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Europe/Moscow';
  const id = 'AU-' + Utilities.formatDate(new Date(), timeZone, 'yyyyMMddHHmmss') +
    '-' + Math.floor(Math.random() * 1000);
  sheet.appendRow([
    id,
    new Date(),
    action,
    entity || '',
    description || '',
    undoPayload ? JSON.stringify(undoPayload) : '',
    false,
    'MiniApp'
  ]);
  return id;
}
