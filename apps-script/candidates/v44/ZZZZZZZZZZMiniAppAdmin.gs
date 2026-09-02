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
