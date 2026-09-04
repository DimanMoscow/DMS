// DMS Fitness Mini App administrative API v38.
const DMS_MINI_APP_API = {
  REQUEST_MARKER: 'dms-fitness-miniapp',
  VERSION: 1,
  MAX_INIT_DATA_LENGTH: 8192,
  MAX_AUTH_AGE_SECONDS: 21600,
  MAX_FUTURE_SKEW_SECONDS: 300,
  RELEASE: 'v38-admin-today'
};

function isDmsMiniAppRequest_(body) {
  return Boolean(body && body.dmsMiniApp === DMS_MINI_APP_API.REQUEST_MARKER);
}

function handleDmsMiniAppRequest_(body) {
  try {
    if (Number(body.version) !== DMS_MINI_APP_API.VERSION) {
      return dmsMiniAppJsonResponse_({ok: false, error: 'unsupported_version'}, 400);
    }

    const auth = validateDmsMiniAppInitData_(body.initData, new Date());
    if (!auth.ok) {
      return dmsMiniAppJsonResponse_({ok: false, error: auth.error}, 401);
    }
    const action = String(body.action || 'bootstrap');
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    if (action === 'resolve_miniapp_entry') {
      return handleDmsMiniAppEntryRequest_(auth, body);
    }
    if (action === 'client_portal_bootstrap') {
      return handleDmsClientPortalRequest_(auth, body);
    }
    if (action === 'client_portal_enroll') {
      return handleDmsClientPortalEnrollmentRequest_(auth, body);
    }
    if (!isDmsMiniAppAdmin_(auth.user.id)) {
      return dmsMiniAppJsonResponse_({ok: false, error: 'access_denied'}, 403);
    }

    let data;
    if (action === 'bootstrap') data = getDmsMiniAppBootstrap_();
    else if (action === 'client') data = getDmsMiniAppClient_(payload.clientId);
    else if (action === 'health') data = getDmsMiniAppHealth_();
    else if (action === 'create_client_portal_invite') {
      data = createDmsClientPortalInvite_(payload.clientId);
    }
    else if (action === 'revoke_client_portal_invite') {
      data = revokeDmsClientPortalInvite_(payload.clientId, payload.inviteId);
    }
    else if (action === 'create_client_measurement') {
      data = createDmsClientPortalMeasurement_(payload, String(auth.user.id));
    }
    else if (action === 'correct_client_measurement') {
      data = correctDmsClientPortalMeasurement_(payload, String(auth.user.id));
    }
    else if (action === 'set_queue_decision') data = setDmsMiniAppQueueDecision_(payload);
    else if (action === 'confirm_day') data = confirmDmsMiniAppDay_(payload);
    else return dmsMiniAppJsonResponse_({ok: false, error: 'unknown_action'}, 400);

    return dmsMiniAppJsonResponse_({
      ok: true,
      release: DMS_MINI_APP_API.RELEASE,
      user: {
        id: String(auth.user.id),
        firstName: String(auth.user.first_name || '')
      },
      data: data
    }, 200);
  } catch (error) {
    const failure = getDmsMiniAppFailure_(error);
    console.error('Mini App API: ' + (error && error.message ? error.message : error));
    return dmsMiniAppJsonResponse_({ok: false, error: failure.code}, failure.status);
  }
}

function validateDmsMiniAppInitData_(initData, now) {
  const raw = String(initData || '');
  if (!raw || raw.length > DMS_MINI_APP_API.MAX_INIT_DATA_LENGTH) {
    return {ok: false, error: 'invalid_init_data'};
  }

  const values = {};
  raw.split('&').forEach(function(part) {
    const separator = part.indexOf('=');
    const encodedKey = separator === -1 ? part : part.substring(0, separator);
    const encodedValue = separator === -1 ? '' : part.substring(separator + 1);
    const key = decodeURIComponent(encodedKey.replace(/\+/g, '%20'));
    const value = decodeURIComponent(encodedValue.replace(/\+/g, '%20'));
    if (key) values[key] = value;
  });

  const receivedHash = String(values.hash || '').toLowerCase();
  const authDate = Number(values.auth_date);
  if (!/^[a-f0-9]{64}$/.test(receivedHash) || !authDate) {
    return {ok: false, error: 'invalid_init_data'};
  }

  const nowSeconds = Math.floor((now instanceof Date ? now.getTime() : Date.now()) / 1000);
  if (authDate > nowSeconds + DMS_MINI_APP_API.MAX_FUTURE_SKEW_SECONDS ||
      nowSeconds - authDate > DMS_MINI_APP_API.MAX_AUTH_AGE_SECONDS) {
    return {ok: false, error: 'expired_init_data'};
  }

  const dataCheckString = Object.keys(values)
    .filter(function(key) { return key !== 'hash'; })
    .sort()
    .map(function(key) { return key + '=' + values[key]; })
    .join('\n');
  const token = getTelegramProperty_(DMS_TELEGRAM.PROP_TOKEN);
  if (!token) return {ok: false, error: 'server_not_configured'};

  const secretKey = Utilities.computeHmacSha256Signature(token, 'WebAppData');
  const signature = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(dataCheckString).getBytes(),
    secretKey
  );
  const expectedHash = signature.map(function(value) {
    return ('0' + ((value < 0 ? value + 256 : value) & 255).toString(16)).slice(-2);
  }).join('');
  if (!dmsMiniAppConstantTimeEqual_(expectedHash, receivedHash)) {
    return {ok: false, error: 'invalid_signature'};
  }

  let user;
  try {
    user = JSON.parse(values.user || '{}');
  } catch (ignore) {
    return {ok: false, error: 'invalid_user'};
  }
  if (!user || user.id === undefined || user.id === null) {
    return {ok: false, error: 'invalid_user'};
  }
  return {
    ok: true,
    user: user,
    authDate: authDate,
    startParam: String(values.start_param || '')
  };
}

function dmsMiniAppConstantTimeEqual_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    mismatch |= (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^
      (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return mismatch === 0;
}

function isDmsMiniAppAdmin_(userId) {
  return getTelegramProperty_(DMS_TELEGRAM.PROP_ADMIN_IDS)
    .split(/[\s,;]+/)
    .filter(Boolean)
    .indexOf(String(userId)) !== -1;
}

function getDmsMiniAppBootstrap_() {
  const startedAt = Date.now();
  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const now = new Date();
  const queue = getDmsMiniAppQueueSnapshot_(now, ss, timeZone);
  const clientRows = getTelegramActiveClients_();
  const clients = [];
  const operational = {
    activeClients: clientRows.length,
    openBlocks: 0,
    lowBlocks: 0,
    debtClients: 0,
    exhaustedOpenBlocks: 0
  };

  clientRows.forEach(function(client) {
    const row = client.values;
    const singlePrice = getSingleTrainingPrice_(row[10]);
    const remaining = dmsMiniAppNumber_(row[6]);
    const debt = parseTelegramMoney_(row[9]);
    if (debt > 0) operational.debtClients++;
    if (row[3]) {
      operational.openBlocks++;
      if (remaining <= 2) operational.lowBlocks++;
      if (remaining <= 0) operational.exhaustedOpenBlocks++;
    }
    clients.push({
      id: String(client.id),
      name: String(client.name),
      status: String(row[2] || ''),
      blockId: String(row[3] || ''),
      format: String(row[4] || ''),
      completed: dmsMiniAppNumber_(row[5]),
      remaining: remaining,
      blockPrice: parseTelegramMoney_(row[7]),
      paid: parseTelegramMoney_(row[8]),
      debt: debt,
      singlePrice: Number(singlePrice) || 0
    });
  });

  return {
    generatedAt: now.toISOString(),
    durationMs: Date.now() - startedAt,
    timeZone: timeZone,
    today: {
      dateKey: queue.dateKey,
      title: queue.title,
      waiting: queue.items.map(function(item) {
        return {
          queueId: item.queueId,
          start: dmsMiniAppDateValue_(item.start),
          end: dmsMiniAppDateValue_(item.end),
          time: item.start instanceof Date
            ? Utilities.formatDate(item.start, timeZone, 'HH:mm')
            : '',
          endTime: item.end instanceof Date
            ? Utilities.formatDate(item.end, timeZone, 'HH:mm')
            : '',
          client: item.client,
          blockId: item.blockId,
          matching: item.matching,
          decision: item.decision,
          status: item.status,
          processed: item.processed
        };
      })
    },
    summary: {
      activeClients: operational.activeClients,
      openBlocks: operational.openBlocks,
      lowBlocks: operational.lowBlocks,
      debtClients: operational.debtClients,
      queueWaiting: queue.queueWaiting,
      queueErrors: queue.queueErrors,
      exhaustedOpenBlocks: operational.exhaustedOpenBlocks
    },
    clients: clients,
    report: getDmsMiniAppReport_()
  };
}

function getDmsMiniAppQueueSnapshot_(date, ss, timeZone) {
  const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
  const dateKey = makeDateKey_(date, timeZone);
  const result = {
    dateKey: dateKey,
    title: Utilities.formatDate(date, timeZone, 'dd.MM.yyyy'),
    items: [],
    queueWaiting: 0,
    queueErrors: 0
  };
  const lastRow = queue.getLastRow();
  if (lastRow < DMS_TELEGRAM.QUEUE_FIRST_ROW) return result;

  queue.getRange(
    DMS_TELEGRAM.QUEUE_FIRST_ROW,
    1,
    lastRow - DMS_TELEGRAM.QUEUE_FIRST_ROW + 1,
    DMS_TELEGRAM.QUEUE_COLUMNS
  ).getValues().forEach(function(row) {
    const status = String(row[13] || '');
    if (status === 'Ожидает') result.queueWaiting++;
    if (status === 'Ошибка') result.queueErrors++;
    if (!row[0] || !(row[1] instanceof Date)) return;
    if (makeDateKey_(row[1], timeZone) !== dateKey) return;
    result.items.push({
      queueId: String(row[0]),
      start: row[5],
      end: row[6],
      client: String(row[9] || row[7] || 'Не распознано'),
      blockId: String(row[10] || ''),
      matching: String(row[11] || ''),
      decision: String(row[12] || ''),
      status: status,
      processed: status === 'Обработано'
    });
  });
  result.items.sort(function(left, right) {
    return left.start - right.start;
  });
  return result;
}

function getDmsMiniAppClient_(clientId) {
  const id = String(clientId || '').trim();
  if (!/^CL-[A-Za-z0-9_-]+$/.test(id)) throw new Error('Некорректный ID клиента.');
  const card = getTelegramClientCard_(id);
  const upcoming = getTelegramUpcomingClientTrainings_(card.id, new Date(), 8, {
    mainTitle: card.calendarTitle,
    aliases: card.calendarAliases
  });
  return {
    id: card.id,
    name: card.name,
    status: card.status,
    blockId: card.blockId,
    format: card.format,
    completed: card.completedNumber,
    remaining: card.remainingNumber,
    blockPrice: parseTelegramMoney_(card.blockPrice),
    paid: parseTelegramMoney_(card.paid),
    debt: parseTelegramMoney_(card.debt),
    singlePrice: Number(card.singlePrice) || 0,
    conditions: card.conditions,
    blockStatus: card.blockStatus,
    blockTotal: card.blockTotal,
    blockStart: dmsMiniAppDateValue_(card.blockStart),
    trainingDates: card.trainingDates.slice(),
    undatedTrainings: card.undatedTrainings,
    undatedCharged: card.undatedCharged,
    upcoming: upcoming.items.map(function(item) {
      return {label: item.label};
    }),
    upcomingMore: upcoming.more,
    clientPortal: getDmsClientPortalAdminState_(card.id),
    measurements: getDmsClientPortalAdminMeasurements_(card.id)
  };
}

function getDmsMiniAppReport_() {
  const report = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM.REPORT);
  const labels = {
    'Проведено тренировок': 'trainings',
    'Всего заработано работой': 'earned',
    'Получено денег': 'received',
    'Оплаченные рабочие расходы': 'expenses',
    'Денежный результат': 'cashResult',
    'Дебиторская задолженность': 'receivables'
  };
  const metrics = {};
  const rows = report.getRange('A3:B17').getDisplayValues();
  rows.slice(3).forEach(function(row) {
    if (labels[row[0]]) metrics[labels[row[0]]] = String(row[1] || '—');
  });
  return {
    month: String(rows[0][1] || ''),
    metrics: metrics
  };
}

function getDmsMiniAppHealth_() {
  const report = runDmsReadOnlySelfTests();
  const health = getDmsSystemHealth();
  return {
    ok: report.ok,
    checkedAt: dmsMiniAppDateValue_(report.checkedAt),
    durationMs: report.durationMs,
    passed: report.checks.filter(function(check) { return check.ok; }).length,
    total: report.checks.length,
    failures: report.checks.filter(function(check) { return !check.ok; }).map(function(check) {
      return {name: check.name, details: String(check.details || '').slice(0, 240)};
    }),
    queueWaiting: health.queueWaiting,
    queueErrors: health.queueErrors,
    exhaustedOpenBlocks: health.exhaustedOpenBlocks.length,
    triggerCount: health.triggers.length
  };
}

function dmsMiniAppDateValue_(value) {
  return value instanceof Date && !isNaN(value.getTime()) ? value.toISOString() : '';
}

function dmsMiniAppNumber_(value) {
  const parsed = Number(String(value === undefined ? '' : value).replace(/[^\d.-]/g, ''));
  return isNaN(parsed) ? 0 : parsed;
}

function dmsMiniAppJsonResponse_(body, status) {
  const payload = Object.assign({status: Number(status) || 200}, body || {});
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function runDmsMiniAppReadOnlyApiSelfTest() {
  const data = getDmsMiniAppBootstrap_();
  const result = {
    ok: Boolean(data && data.clients && data.summary && data.today && data.report),
    release: DMS_MINI_APP_API.RELEASE,
    activeClients: data.clients.length,
    queueWaiting: data.summary.queueWaiting,
    queueErrors: data.summary.queueErrors,
    exhaustedOpenBlocks: data.summary.exhaustedOpenBlocks,
    durationMs: data.durationMs
  };
  console.log(JSON.stringify(result));
  return result;
}

/**
 * Read-only production diagnostic for the complete Telegram auth + bootstrap path.
 * It uses the stored token internally and logs no token or signed initData.
 */
function runDmsMiniAppAuthAndBootstrapSelfTest() {
  const adminId = getTelegramProperty_(DMS_TELEGRAM.PROP_ADMIN_IDS)
    .split(/[\s,;]+/)
    .filter(Boolean)[0];
  if (!adminId) throw new Error('Не задан Telegram admin ID.');

  const authDate = Math.floor(Date.now() / 1000);
  const values = {
    auth_date: String(authDate),
    query_id: 'DMS_READ_ONLY_SELF_TEST',
    user: JSON.stringify({id: Number(adminId), first_name: 'DMS'})
  };
  const dataCheckString = Object.keys(values).sort().map(function(key) {
    return key + '=' + values[key];
  }).join('\n');
  const token = getTelegramProperty_(DMS_TELEGRAM.PROP_TOKEN);
  const secretKey = Utilities.computeHmacSha256Signature(token, 'WebAppData');
  const signature = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(dataCheckString).getBytes(),
    secretKey
  );
  const hash = signature.map(function(value) {
    return ('0' + ((value < 0 ? value + 256 : value) & 255).toString(16)).slice(-2);
  }).join('');
  const initData = Object.keys(values).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(values[key]);
  }).concat('hash=' + hash).join('&');

  const auth = validateDmsMiniAppInitData_(initData, new Date());
  if (!auth.ok) throw new Error('Auth self-test failed: ' + auth.error);
  if (!isDmsMiniAppAdmin_(auth.user.id)) throw new Error('Admin self-test failed.');
  const data = getDmsMiniAppBootstrap_();
  const result = {
    ok: Boolean(data && data.clients && data.summary && data.today && data.report),
    authOk: true,
    adminOk: true,
    activeClients: data.clients.length,
    queueWaiting: data.summary.queueWaiting,
    queueErrors: data.summary.queueErrors,
    durationMs: data.durationMs
  };
  console.log(JSON.stringify(result));
  return result;
}
