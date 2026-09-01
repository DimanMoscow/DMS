const DMS_TELEGRAM = {
  WEB_APP_URL: '__DMS_APPS_SCRIPT_PRODUCTION_URL__',
  QUEUE: 'Очередь подтверждения',
  CLIENTS: 'Клиенты',
  REPORT: 'Отчёт',
  QUEUE_FIRST_ROW: 4,
  QUEUE_COLUMNS: 17,
  CLIENT_FIRST_ROW: 5,
  PROP_TOKEN: 'DMS_TG_BOT_TOKEN',
  PROP_ADMIN_IDS: 'DMS_TG_ADMIN_USER_IDS',
  PROP_CHAT_ID: 'DMS_TG_CHAT_ID',
  PROP_SECRET: 'DMS_TG_WEBHOOK_SECRET',
  DAILY_HANDLER: 'sendTelegramDailyQueue'
};

// Public, non-sensitive release identity used to prove which immutable source
// bundle is actually serving the web-app URL after a deployment update.
const DMS_RUNTIME_IDENTITY = {
  SERVICE: 'dms-fitness-apps-script',
  RELEASE: 'client-portal-runtime-r1',
  ROUTER_SHA256: '7aabbe7c04db333dfa64f79c5f03c572a16ea73ef7c176e9be7def5a5086e02a',
  CLIENT_PORTAL_SHA256: '0bf17f137679cc1f605d63bd3c4c746858de33eef3919038bcaeecef4a29332e'
};

/**
 * Telegram webhook entry point. Deploy the Apps Script project as a Web App:
 * execute as the owner, access for anyone. The secret query parameter protects
 * the endpoint, and every update is additionally checked against the admin IDs.
 */
function doPostV1_(e) {
  try {
    if (!isValidTelegramWebhook_(e)) {
      return telegramTextResponse_('forbidden');
    }

    const update = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (update.callback_query) {
      handleTelegramCallback_(update.callback_query);
    } else if (update.message) {
      handleTelegramMessage_(update.message);
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
  }

  return telegramTextResponse_('ok');
}

function doGet(e) {
  if (String(e && e.parameter && e.parameter.dms_runtime_identity || '') === '1') {
    return ContentService
      .createTextOutput(JSON.stringify(getDmsRuntimeIdentity_()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService
    .createTextOutput('DMS Fitness Telegram integration is running.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function getDmsRuntimeIdentity_() {
  return {
    ok: true,
    service: DMS_RUNTIME_IDENTITY.SERVICE,
    release: DMS_RUNTIME_IDENTITY.RELEASE,
    routerSha256: DMS_RUNTIME_IDENTITY.ROUTER_SHA256,
    clientPortalSha256: DMS_RUNTIME_IDENTITY.CLIENT_PORTAL_SHA256,
    clientPortalHandlerLoaded: typeof handleDmsClientPortalRequest_ === 'function'
  };
}

/**
 * Run once after Web App deployment and after Script Properties are filled.
 * It registers the webhook and installs the daily digest trigger.
 */
function installTelegramAutomation() {
  validateTelegramConfiguration_();
  setTelegramWebhook_();
  installTelegramDailyTrigger_();

  const chatId = getTelegramProperty_(DMS_TELEGRAM.PROP_CHAT_ID);
  telegramSendMessage_(chatId,
    '<b>DMS Fitness подключён</b>\n' +
    'Календарь → очередь → подтверждение → журнал и остатки.\n\n' +
    telegramHelpText_(),
    null
  );

  return 'Telegram подключён. Webhook и ежедневный триггер установлены.';
}

/** Re-registers only the webhook, without sending setup messages. */
function repairTelegramWebhook() {
  validateTelegramConfiguration_();
  setTelegramWebhook_();
  return 'Telegram webhook исправлен.';
}

function uninstallTelegramAutomation() {
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return trigger.getHandlerFunction() === DMS_TELEGRAM.DAILY_HANDLER;
    })
    .forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  const token = getTelegramProperty_(DMS_TELEGRAM.PROP_TOKEN);
  if (token) telegramApi_('deleteWebhook', {drop_pending_updates: false});

  return 'Telegram webhook и ежедневный триггер отключены.';
}

function getTelegramSetupStatus() {
  const props = PropertiesService.getScriptProperties();
  const required = [
    DMS_TELEGRAM.PROP_TOKEN,
    DMS_TELEGRAM.PROP_ADMIN_IDS,
    DMS_TELEGRAM.PROP_CHAT_ID
  ];
  const missing = required.filter(function(key) {
    return !String(props.getProperty(key) || '').trim();
  });

  return {
    configured: missing.length === 0,
    missing: missing,
    webAppUrl: ScriptApp.getService().getUrl() || '',
    dailyTriggerInstalled: ScriptApp.getProjectTriggers().some(function(trigger) {
      return trigger.getHandlerFunction() === DMS_TELEGRAM.DAILY_HANDLER;
    })
  };
}

/** Logs webhook health without exposing the bot token or secret URL. */
function logTelegramWebhookHealth() {
  const info = telegramApi_('getWebhookInfo', {}) || {};
  const registeredBaseUrl = String(info.url || '').split('?')[0];
  const serviceBaseUrl = String(ScriptApp.getService().getUrl() || '').split('?')[0];
  const health = {
    webhookConfigured: Boolean(info.url),
    registeredBaseUrl: registeredBaseUrl,
    serviceBaseUrl: serviceBaseUrl,
    registeredUrlMatchesService: registeredBaseUrl === serviceBaseUrl,
    pendingUpdateCount: Number(info.pending_update_count || 0),
    lastErrorDate: info.last_error_date || null,
    lastErrorMessage: info.last_error_message || '',
    maxConnections: info.max_connections || null,
    allowedUpdates: info.allowed_updates || []
  };
  console.log(JSON.stringify(health));
  return health;
}

/**
 * Bootstrap helper. Before the webhook is installed, send /start to the bot,
 * then run this function once. It stores the latest private sender as admin.
 */
function discoverTelegramAdmin() {
  const token = getTelegramProperty_(DMS_TELEGRAM.PROP_TOKEN);
  if (!token) throw new Error('Сначала задай ' + DMS_TELEGRAM.PROP_TOKEN + '.');

  const updates = telegramApi_('getUpdates', {
    offset: -20,
    limit: 20,
    timeout: 0,
    allowed_updates: ['message']
  }) || [];
  const privateMessages = updates
    .map(function(update) { return update.message || null; })
    .filter(function(message) {
      return message && message.from && message.chat &&
        message.chat.type === 'private';
    });

  if (!privateMessages.length) {
    throw new Error('Напиши боту /start и запусти функцию ещё раз.');
  }

  const latest = privateMessages[privateMessages.length - 1];
  PropertiesService.getScriptProperties().setProperties({
    DMS_TG_ADMIN_USER_IDS: String(latest.from.id),
    DMS_TG_CHAT_ID: String(latest.chat.id)
  });

  return {
    adminUserId: String(latest.from.id),
    chatId: String(latest.chat.id),
    username: latest.from.username || '',
    firstName: latest.from.first_name || ''
  };
}

function sendTelegramDailyQueueV1_() {
  validateTelegramConfiguration_();
  syncCalendarToQueue();

  const chatId = getTelegramProperty_(DMS_TELEGRAM.PROP_CHAT_ID);
  const date = new Date();
  const dashboard = buildTelegramQueueDashboard_(date);

  if (!dashboard.items.length) return 'На сегодня нет ожидающих подтверждения.';

  telegramSendMessage_(chatId, dashboard.text, dashboard.replyMarkup);
  return 'Отправлено событий: ' + dashboard.items.length + '.';
}

function sendTelegramTestMessage() {
  validateTelegramConfiguration_();
  const chatId = getTelegramProperty_(DMS_TELEGRAM.PROP_CHAT_ID);
  telegramSendMessage_(chatId, '<b>DMS Fitness</b>\nТест связи успешен.', null);
  return 'Тестовое сообщение отправлено.';
}

function handleTelegramMessageLegacyV1_(message) {
  const chatId = message.chat && message.chat.id;
  const userId = message.from && message.from.id;

  if (!isTelegramAdmin_(userId, chatId)) return;

  const text = String(message.text || '').trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();

  if (command === '/today' || command === '/day') {
    syncCalendarToQueue();
    sendTelegramQueueDashboard_(chatId, new Date());
    return;
  }

  if (command === '/yesterday') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    sendTelegramQueueDashboard_(chatId, date);
    return;
  }

  if (command === '/balances' || command === '/clients') {
    telegramSendMessage_(chatId, buildTelegramBalancesText_(), null);
    return;
  }

  if (command === '/debt') {
    telegramSendMessage_(chatId, buildTelegramDebtText_(), null);
    return;
  }

  if (command === '/report') {
    telegramSendMessage_(chatId, buildTelegramReportText_(), null);
    return;
  }

  if (command === '/chatid') {
    telegramSendMessage_(chatId,
      'User ID: <code>' + escapeTelegramHtml_(userId) + '</code>\n' +
      'Chat ID: <code>' + escapeTelegramHtml_(chatId) + '</code>',
      null
    );
    return;
  }

  telegramSendMessage_(chatId, telegramHelpText_(), null);
}

function handleTelegramCallbackV1_(query) {
  const message = query.message || {};
  const chatId = message.chat && message.chat.id;
  const userId = query.from && query.from.id;

  if (!isTelegramAdmin_(userId, chatId)) {
    telegramAnswerCallback_(query.id, 'Нет доступа', true);
    return;
  }

  const data = String(query.data || '');

  if (data.indexOf('qd:') === 0) {
    const parts = data.split(':');
    const queueId = parts[1];
    const decisionCode = parts[2];
    const result = setTelegramQueueDecision_(queueId, decisionCode);

    telegramAnswerCallback_(query.id, result.notice, false);
    refreshTelegramQueueMessage_(chatId, message.message_id, result.date);
    return;
  }

  if (data.indexOf('qp:') === 0) {
    const dateKey = data.substring(3);
    telegramAnswerCallback_(query.id, 'Обрабатываю день…', false);

    try {
      syncCalendarToQueue();
      const date = parseTelegramDateKey_(dateKey);
      activateStartedPlannedBlocksForDate_(date);
      const result = processQueueDate_(date, 'Telegram', false);
      const text = '<b>День подтверждён</b>\n' +
        escapeTelegramHtml_(formatQueueProcessingSummary_(result)) +
        buildTelegramWarningsText_();

      telegramEditMessage_(chatId, message.message_id, text, null);
    } catch (error) {
      telegramSendMessage_(chatId,
        '<b>Не удалось подтвердить день</b>\n' +
        escapeTelegramHtml_(error.message || String(error)),
        null
      );
    }
    return;
  }

  if (data.indexOf('qr:') === 0) {
    const date = parseTelegramDateKey_(data.substring(3));
    telegramAnswerCallback_(query.id, 'Обновляю…', false);
    syncCalendarToQueue();
    refreshTelegramQueueMessage_(chatId, message.message_id, date);
    return;
  }

  telegramAnswerCallback_(query.id, 'Команда устарела', false);
}

function sendTelegramQueueDashboard_(chatId, date) {
  const dashboard = buildTelegramQueueDashboard_(date);

  if (!dashboard.items.length) {
    telegramSendMessage_(chatId,
      '<b>' + escapeTelegramHtml_(dashboard.title) + '</b>\n' +
      'Ожидающих подтверждения событий нет.',
      null
    );
    return;
  }

  telegramSendMessage_(chatId, dashboard.text, dashboard.replyMarkup);
}

function refreshTelegramQueueMessage_(chatId, messageId, date) {
  const dashboard = buildTelegramQueueDashboard_(date);
  const text = dashboard.items.length
    ? dashboard.text
    : '<b>' + escapeTelegramHtml_(dashboard.title) + '</b>\n' +
      'Ожидающих подтверждения событий нет.';

  telegramEditMessage_(chatId, messageId, text,
    dashboard.items.length ? dashboard.replyMarkup : null
  );
}

function buildTelegramQueueDashboard_(date) {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const dateKey = makeDateKey_(date, timeZone);
  const title = Utilities.formatDate(date, timeZone, 'dd.MM.yyyy');
  const lastRow = queue.getLastRow();
  const items = [];

  if (lastRow >= DMS_TELEGRAM.QUEUE_FIRST_ROW) {
    queue.getRange(
      DMS_TELEGRAM.QUEUE_FIRST_ROW,
      1,
      lastRow - DMS_TELEGRAM.QUEUE_FIRST_ROW + 1,
      DMS_TELEGRAM.QUEUE_COLUMNS
    ).getValues().forEach(function(row) {
      if (!row[0] || !(row[1] instanceof Date)) return;
      if (makeDateKey_(row[1], timeZone) !== dateKey) return;
      if (String(row[13] || '') === 'Обработано') return;

      items.push({
        queueId: String(row[0]),
        start: row[5],
        end: row[6],
        client: String(row[9] || row[7] || 'Не распознано'),
        blockId: String(row[10] || ''),
        matching: String(row[11] || ''),
        decision: String(row[12] || ''),
        status: String(row[13] || '')
      });
    });
  }

  items.sort(function(a, b) {
    return a.start - b.start;
  });

  const lines = [
    '<b>Тренировки за ' + escapeTelegramHtml_(title) + '</b>',
    'Проверь исключения и подтверди день одной кнопкой.'
  ];
  const keyboard = [];

  items.forEach(function(item, index) {
    const time = item.start instanceof Date
      ? Utilities.formatDate(item.start, timeZone, 'HH:mm')
      : '—';
    const icon = telegramDecisionIcon_(item.decision);
    const block = item.blockId ? ' · ' + item.blockId : ' · разовая';

    lines.push(
      (index + 1) + '. ' + icon + ' <b>' + escapeTelegramHtml_(time) + '</b> ' +
      escapeTelegramHtml_(item.client + block)
    );

    keyboard.push([
      {text: '✅ ' + (index + 1), callback_data: 'qd:' + item.queueId + ':done'},
      {text: '💸 ' + (index + 1), callback_data: 'qd:' + item.queueId + ':charge'},
      {text: '🚫 ' + (index + 1), callback_data: 'qd:' + item.queueId + ':free'},
      {text: '↔️ ' + (index + 1), callback_data: 'qd:' + item.queueId + ':move'}
    ]);
  });

  if (items.length) {
    keyboard.push([{
      text: '✅ Подтвердить день',
      callback_data: 'qp:' + dateKey
    }]);
    keyboard.push([{
      text: '🔄 Обновить из календаря',
      callback_data: 'qr:' + dateKey
    }]);
    lines.push('', '✅ проведена · 💸 списать · 🚫 без списания · ↔️ перенос');
  }

  return {
    dateKey: dateKey,
    title: title,
    items: items,
    text: lines.join('\n'),
    replyMarkup: keyboard.length ? {inline_keyboard: keyboard} : null
  };
}

function setTelegramQueueDecisionLegacyV1_(queueId, decisionCode) {
  const decisions = {
    done: 'Проведена',
    charge: 'Отмена со списанием',
    free: 'Отмена без списания',
    move: 'Перенос'
  };
  const decision = decisions[decisionCode];

  if (!decision) throw new Error('Неизвестное решение очереди.');

  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
  const row = findRowByValue_(
    queue,
    1,
    queueId,
    DMS_TELEGRAM.QUEUE_FIRST_ROW
  );

  if (!row) throw new Error('Строка ' + queueId + ' не найдена.');

  const values = queue.getRange(row, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS).getValues()[0];

  if (String(values[13] || '') === 'Обработано') {
    throw new Error('Событие уже обработано.');
  }

  queue.getRange(row, 13).setValue(decision);
  queue.getRange(row, 14).setValue('Ожидает');
  queue.getRange(row, 16).setValue('Telegram');

  return {
    date: values[1],
    notice: decision
  };
}

function buildTelegramBalancesText_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = getRequiredSheet_(ss, DMS_TELEGRAM.CLIENTS);
  const lastRow = sheet.getLastRow();
  const lines = ['<b>Остатки активных клиентов</b>'];

  if (lastRow < DMS_TELEGRAM.CLIENT_FIRST_ROW) return lines.join('\n');

  sheet.getRange(
    DMS_TELEGRAM.CLIENT_FIRST_ROW,
    1,
    lastRow - DMS_TELEGRAM.CLIENT_FIRST_ROW + 1,
    11
  ).getDisplayValues().forEach(function(row) {
    if (!row[0] || row[2] !== 'Активен') return;

    const rest = row[3] ? row[6] + ' тр.' : 'разовые';
    const debt = parseTelegramMoney_(row[9]);
    const debtText = debt > 0 ? ' · долг ' + row[9] : '';

    lines.push('• ' + escapeTelegramHtml_(row[1]) + ' — ' +
      escapeTelegramHtml_(rest + debtText));
  });

  return lines.join('\n');
}

function buildTelegramDebtText_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = getRequiredSheet_(ss, DMS_TELEGRAM.CLIENTS);
  const lastRow = sheet.getLastRow();
  const lines = ['<b>Дебиторская задолженность</b>'];
  let found = false;

  if (lastRow >= DMS_TELEGRAM.CLIENT_FIRST_ROW) {
    sheet.getRange(
      DMS_TELEGRAM.CLIENT_FIRST_ROW,
      1,
      lastRow - DMS_TELEGRAM.CLIENT_FIRST_ROW + 1,
      11
    ).getDisplayValues().forEach(function(row) {
      if (!row[0]) return;
      if (parseTelegramMoney_(row[9]) <= 0) return;

      found = true;
      lines.push('• ' + escapeTelegramHtml_(row[1]) + ' — ' +
        escapeTelegramHtml_(row[9]));
    });
  }

  if (!found) lines.push('Долгов нет.');
  return lines.join('\n');
}

function buildTelegramReportTextLegacyV1_() {
  const ss = SpreadsheetApp.getActive();
  const report = getRequiredSheet_(ss, DMS_TELEGRAM.REPORT);
  const month = report.getRange('B3').getDisplayValue();
  const rows = report.getRange('A6:B17').getDisplayValues();
  const wanted = {
    'Проведено тренировок': true,
    'Всего заработано работой': true,
    'Получено денег': true,
    'Оплаченные рабочие расходы': true,
    'Денежный результат': true,
    'Дебиторская задолженность': true
  };
  const lines = ['<b>Отчёт — ' + escapeTelegramHtml_(month) + '</b>'];

  rows.forEach(function(row) {
    if (!wanted[row[0]]) return;
    lines.push('• ' + escapeTelegramHtml_(row[0]) + ': <b>' +
      escapeTelegramHtml_(row[1]) + '</b>');
  });

  return lines.join('\n');
}

function buildTelegramWarningsText_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = getRequiredSheet_(ss, DMS_TELEGRAM.CLIENTS);
  const lastRow = sheet.getLastRow();
  const warnings = [];

  if (lastRow >= DMS_TELEGRAM.CLIENT_FIRST_ROW) {
    sheet.getRange(
      DMS_TELEGRAM.CLIENT_FIRST_ROW,
      1,
      lastRow - DMS_TELEGRAM.CLIENT_FIRST_ROW + 1,
      11
    ).getDisplayValues().forEach(function(row) {
      if (!row[0] || row[2] !== 'Активен') return;

      const rest = Number(String(row[6] || '').replace(',', '.'));
      const debt = parseTelegramMoney_(row[9]);

      if (row[3] && !isNaN(rest) && rest <= 2) {
        warnings.push(escapeTelegramHtml_(row[1]) + ': осталось ' + rest);
      }
      if (debt > 0) {
        warnings.push(escapeTelegramHtml_(row[1]) + ': долг ' +
          escapeTelegramHtml_(row[9]));
      }
    });
  }

  return warnings.length
    ? '\n\n<b>Внимание</b>\n• ' + warnings.join('\n• ')
    : '';
}

/**
 * Planned blocks are converted to active only when an ended training from that
 * block is about to be counted. Payment fields are untouched, so debt remains.
 */
function activateStartedPlannedBlocksForDate_(date) {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
  const blocks = getRequiredSheet_(ss, 'Блоки');
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const dateKey = makeDateKey_(date, timeZone);
  const now = new Date();
  const queueLastRow = queue.getLastRow();
  const blockLastRow = blocks.getLastRow();

  if (queueLastRow < DMS_TELEGRAM.QUEUE_FIRST_ROW || blockLastRow < 4) return 0;

  const planned = {};
  blocks.getRange(4, 1, blockLastRow - 3, 4).getValues().forEach(function(row, index) {
    if (row[0] && row[3] === 'Запланирован') {
      planned[String(row[0])] = 4 + index;
    }
  });

  const toActivate = {};
  queue.getRange(
    DMS_TELEGRAM.QUEUE_FIRST_ROW,
    1,
    queueLastRow - DMS_TELEGRAM.QUEUE_FIRST_ROW + 1,
    DMS_TELEGRAM.QUEUE_COLUMNS
  ).getValues().forEach(function(row) {
    if (!(row[1] instanceof Date) || makeDateKey_(row[1], timeZone) !== dateKey) return;
    if (row[13] === 'Обработано') return;
    if (['Проведена', 'Отмена со списанием'].indexOf(String(row[12] || '')) === -1) return;
    if (!(row[6] instanceof Date) || row[6] > now) return;

    const blockId = String(row[10] || '');
    if (planned[blockId]) toActivate[blockId] = planned[blockId];
  });

  Object.keys(toActivate).forEach(function(blockId) {
    blocks.getRange(toActivate[blockId], 4).setValue('Активен');
  });

  return Object.keys(toActivate).length;
}

function installTelegramDailyTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return trigger.getHandlerFunction() === DMS_TELEGRAM.DAILY_HANDLER;
    })
    .forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger(DMS_TELEGRAM.DAILY_HANDLER)
    .timeBased()
    .atHour(22)
    .everyDays(1)
    .inTimezone('Europe/Moscow')
    .create();
}

function setTelegramWebhook_() {
  let secret = getTelegramProperty_(DMS_TELEGRAM.PROP_SECRET);

  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '');
    PropertiesService.getScriptProperties().setProperty(
      DMS_TELEGRAM.PROP_SECRET,
      secret
    );
  }

  const webAppUrl = DMS_TELEGRAM.WEB_APP_URL;
  if (!webAppUrl) {
    throw new Error('Сначала разверни проект как Web App.');
  }

  telegramApi_('setWebhook', {
    url: webAppUrl + '?key=' + encodeURIComponent(secret),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false
  });
}

function validateTelegramConfiguration_() {
  const status = getTelegramSetupStatus();

  if (!status.configured) {
    throw new Error(
      'Не заполнены Script Properties: ' + status.missing.join(', ')
    );
  }
}

function isValidTelegramWebhook_(e) {
  const expected = getTelegramProperty_(DMS_TELEGRAM.PROP_SECRET);
  const received = e && e.parameter && String(e.parameter.key || '');
  return Boolean(expected && received && expected === received);
}

function isTelegramAdmin_(userId, chatId) {
  const ids = getTelegramProperty_(DMS_TELEGRAM.PROP_ADMIN_IDS)
    .split(/[\s,;]+/)
    .filter(Boolean);
  const configuredChat = getTelegramProperty_(DMS_TELEGRAM.PROP_CHAT_ID);

  return ids.indexOf(String(userId)) !== -1 &&
    (!configuredChat || String(chatId) === configuredChat);
}

function getTelegramProperty_(key) {
  return String(
    PropertiesService.getScriptProperties().getProperty(key) || ''
  ).trim();
}

function telegramApi_(method, payload) {
  const token = getTelegramProperty_(DMS_TELEGRAM.PROP_TOKEN);
  if (!token) throw new Error('Не задан ' + DMS_TELEGRAM.PROP_TOKEN + '.');

  const response = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/' + method,
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload || {}),
      muteHttpExceptions: true
    }
  );
  const code = response.getResponseCode();
  const body = response.getContentText();
  let parsed = {};

  try {
    parsed = JSON.parse(body);
  } catch (ignore) {
    parsed = {description: body};
  }

  if (code < 200 || code >= 300 || !parsed.ok) {
    throw new Error('Telegram API ' + method + ': ' +
      (parsed.description || ('HTTP ' + code)));
  }

  return parsed.result;
}

function telegramSendMessage_(chatId, text, replyMarkup) {
  const payload = {
    chat_id: String(chatId),
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegramApi_('sendMessage', payload);
}

function telegramEditMessage_(chatId, messageId, text, replyMarkup) {
  const payload = {
    chat_id: String(chatId),
    message_id: messageId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: replyMarkup || {inline_keyboard: []}
  };

  try {
    return telegramApi_('editMessageText', payload);
  } catch (error) {
    if (String(error.message || '').indexOf('message is not modified') !== -1) {
      return null;
    }
    throw error;
  }
}

function telegramAnswerCallback_(callbackId, text, showAlert) {
  return telegramApi_('answerCallbackQuery', {
    callback_query_id: callbackId,
    text: text,
    show_alert: Boolean(showAlert),
    cache_time: 0
  });
}

function telegramTextResponse_(text) {
  return HtmlService.createHtmlOutput(String(text || 'ok'));
}

function telegramHelpTextLegacyV1_() {
  return [
    '<b>Команды</b>',
    '/today — подтвердить сегодняшний день',
    '/yesterday — проверить вчерашний день',
    '/balances — остатки тренировок',
    '/debt — долги клиентов',
    '/report — отчёт за выбранный месяц'
  ].join('\n');
}

function telegramDecisionIcon_(decision) {
  const icons = {
    'Проведена': '✅',
    'Отмена со списанием': '💸',
    'Отмена без списания': '🚫',
    'Перенос': '↔️',
    'Не учитывать': '➖'
  };
  return icons[decision] || '❔';
}

function parseTelegramDateKey_(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Некорректная дата: ' + dateKey);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
}

function parseTelegramMoney_(value) {
  return Number(String(value || '').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
}

function escapeTelegramHtml_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// DMS Telegram calendar extension v4
const DMS_TELEGRAM_CALENDAR = {
  MOVE_CACHE_PREFIX: 'DMS_TG_MOVE_',
  MOVE_TTL_SECONDS: 1800
};

function handleTelegramMessageLegacyV4_(message) {
  const chatId = message.chat && message.chat.id;
  const userId = message.from && message.from.id;

  if (!isTelegramAdmin_(userId, chatId)) return;

  const text = String(message.text || '').trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const pendingMove = getTelegramMoveState_(userId, chatId);

  if (command === '/cancel' && pendingMove) {
    cancelTelegramMove_(pendingMove, userId, chatId);
    return;
  }

  if (pendingMove && command.charAt(0) !== '/') {
    handleTelegramMoveInput_(pendingMove, userId, chatId, text);
    return;
  }

  if (command === '/today' || command === '/day') {
    syncCalendarToQueue();
    sendTelegramQueueDashboard_(chatId, new Date());
    return;
  }

  if (command === '/yesterday') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    sendTelegramQueueDashboard_(chatId, date);
    return;
  }

  if (command === '/balances' || command === '/clients') {
    telegramSendMessage_(chatId, buildTelegramBalancesText_(), null);
    return;
  }

  if (command === '/debt') {
    telegramSendMessage_(chatId, buildTelegramDebtText_(), null);
    return;
  }

  if (command === '/report') {
    telegramSendMessage_(chatId, buildTelegramReportText_(), null);
    return;
  }

  if (command === '/chatid') {
    telegramSendMessage_(chatId,
      'User ID: <code>' + escapeTelegramHtml_(userId) + '</code>\n' +
      'Chat ID: <code>' + escapeTelegramHtml_(chatId) + '</code>',
      null
    );
    return;
  }

  telegramSendMessage_(chatId, telegramHelpText_(), null);
}

function handleTelegramCallbackLegacyV4_(query) {
  const message = query.message || {};
  const chatId = message.chat && message.chat.id;
  const userId = query.from && query.from.id;

  if (!isTelegramAdmin_(userId, chatId)) {
    telegramAnswerCallback_(query.id, 'Нет доступа', true);
    return;
  }

  const data = String(query.data || '');

  if (data.indexOf('qd:') === 0) {
    const parts = data.split(':');
    const queueId = parts[1];
    const decisionCode = parts[2];
    const result = setTelegramQueueDecision_(queueId, decisionCode);

    if (decisionCode === 'move') {
      startTelegramMove_(userId, chatId, message.message_id, result);
      telegramAnswerCallback_(query.id, 'Жду новую дату и время', false);
      refreshTelegramQueueMessage_(chatId, message.message_id, result.date);
      return;
    }

    clearTelegramMoveState_(userId, chatId);
    telegramAnswerCallback_(query.id, result.notice, false);
    refreshTelegramQueueMessage_(chatId, message.message_id, result.date);
    return;
  }

  if (data.indexOf('qp:') === 0) {
    const dateKey = data.substring(3);
    telegramAnswerCallback_(query.id, 'Обрабатываю день…', false);

    try {
      syncCalendarToQueue();
      const date = parseTelegramDateKey_(dateKey);
      activateStartedPlannedBlocksForDate_(date);
      const result = processQueueDate_(date, 'Telegram', false);
      const calendarResult = applyTelegramCalendarCancellationsForDate_(date);
      const text = buildTelegramDayConfirmationText_(date, result, calendarResult) +
        buildTelegramWarningsText_();

      telegramEditMessage_(chatId, message.message_id, text, null);
    } catch (error) {
      telegramSendMessage_(chatId,
        '<b>Не удалось подтвердить день</b>\n' +
        escapeTelegramHtml_(error.message || String(error)),
        null
      );
    }
    return;
  }

  if (data.indexOf('qr:') === 0) {
    const date = parseTelegramDateKey_(data.substring(3));
    telegramAnswerCallback_(query.id, 'Обновляю…', false);
    syncCalendarToQueue();
    refreshTelegramQueueMessage_(chatId, message.message_id, date);
    return;
  }

  telegramAnswerCallback_(query.id, 'Команда устарела', false);
}

function setTelegramQueueDecision_(queueId, decisionCode) {
  const decisions = {
    done: 'Проведена',
    charge: 'Отмена со списанием',
    free: 'Отмена без списания',
    move: 'Перенос'
  };
  const decision = decisions[decisionCode];

  if (!decision) throw new Error('Неизвестное решение очереди.');

  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
  const row = findRowByValue_(
    queue,
    1,
    queueId,
    DMS_TELEGRAM.QUEUE_FIRST_ROW
  );

  if (!row) throw new Error('Строка ' + queueId + ' не найдена.');

  const values = queue.getRange(row, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS).getValues()[0];

  if (String(values[13] || '') === 'Обработано') {
    throw new Error('Событие уже обработано.');
  }

  queue.getRange(row, 13).setValue(decision);
  queue.getRange(row, 14).setValue('Ожидает');
  queue.getRange(row, 16).setValue('Telegram');

  return {
    date: values[1],
    notice: decision,
    queueId: queueId,
    client: String(values[9] || values[7] || 'Не распознано'),
    start: values[5],
    end: values[6]
  };
}

function startTelegramMove_(userId, chatId, dashboardMessageId, item) {
  const state = {
    queueId: item.queueId,
    chatId: String(chatId),
    dashboardMessageId: dashboardMessageId,
    originalDateMs: item.date instanceof Date ? item.date.getTime() : 0
  };

  CacheService.getScriptCache().put(
    makeTelegramMoveCacheKey_(userId, chatId),
    JSON.stringify(state),
    DMS_TELEGRAM_CALENDAR.MOVE_TTL_SECONDS
  );

  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const current = item.start instanceof Date
    ? Utilities.formatDate(item.start, timeZone, 'dd.MM.yyyy HH:mm')
    : 'время не указано';

  telegramSendMessage_(chatId,
    '<b>Перенос: ' + escapeTelegramHtml_(item.client) + '</b>\n' +
    'Сейчас: ' + escapeTelegramHtml_(current) + '\n\n' +
    'Пришли новую дату и время одним сообщением:\n' +
    '<code>21.08 19:30</code> или <code>21.08.2026 19:30</code>\n\n' +
    '/cancel — отменить перенос.',
    {
      force_reply: true,
      selective: true,
      input_field_placeholder: '21.08 19:30'
    }
  );
}

function getTelegramMoveState_(userId, chatId) {
  const raw = CacheService.getScriptCache().get(
    makeTelegramMoveCacheKey_(userId, chatId)
  );

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (ignore) {
    clearTelegramMoveState_(userId, chatId);
    return null;
  }
}

function makeTelegramMoveCacheKey_(userId, chatId) {
  return DMS_TELEGRAM_CALENDAR.MOVE_CACHE_PREFIX + String(userId) + '_' + String(chatId);
}

function clearTelegramMoveState_(userId, chatId) {
  CacheService.getScriptCache().remove(
    makeTelegramMoveCacheKey_(userId, chatId)
  );
}

function cancelTelegramMove_(state, userId, chatId) {
  const item = setTelegramQueueDecision_(state.queueId, 'done');
  clearTelegramMoveState_(userId, chatId);

  if (state.dashboardMessageId) {
    refreshTelegramQueueMessage_(
      chatId,
      state.dashboardMessageId,
      new Date(state.originalDateMs || item.date.getTime())
    );
  }

  telegramSendMessage_(chatId, 'Перенос отменён. Тренировка оставлена на прежнем времени.', null);
}

function handleTelegramMoveInput_(state, userId, chatId, text) {
  const lock = LockService.getDocumentLock();

  try {
    if (!lock.tryLock(10000)) {
      throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
    }

    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
    const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
    const row = findRowByValue_(
      queue,
      1,
      state.queueId,
      DMS_TELEGRAM.QUEUE_FIRST_ROW
    );

    if (!row) throw new Error('Строка ' + state.queueId + ' не найдена.');

    const values = queue
      .getRange(row, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS)
      .getValues()[0];

    if (String(values[13] || '') === 'Обработано') {
      throw new Error('Событие уже обработано.');
    }

    const calendarId = String(values[2] || '').trim();
    const eventId = String(values[3] || '').trim();

    if (!calendarId || !eventId) {
      throw new Error('У события отсутствует связь с Google Calendar.');
    }

    const newStart = parseTelegramMoveDate_(text, timeZone, new Date());
    const oldStart = values[5];
    const oldEnd = values[6];
    const durationMs = oldStart instanceof Date && oldEnd instanceof Date
      ? Math.max(oldEnd.getTime() - oldStart.getTime(), 5 * 60 * 1000)
      : 60 * 60 * 1000;
    const newEnd = new Date(newStart.getTime() + durationMs);

    Calendar.Events.patch({
      start: {dateTime: newStart.toISOString(), timeZone: timeZone},
      end: {dateTime: newEnd.toISOString(), timeZone: timeZone}
    }, calendarId, eventId, {sendUpdates: 'none'});

    values[1] = newStart;
    values[5] = newStart;
    values[6] = newEnd;
    values[12] = 'Проведена';
    values[13] = 'Ожидает';
    values[14] = '';
    values[15] = 'Telegram';
    values[16] = mergeQueueComment_(
      values[16],
      'Событие перенесено через Telegram'
    );

    queue
      .getRange(row, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS)
      .setValues([values]);

    clearTelegramMoveState_(userId, chatId);

    if (state.dashboardMessageId) {
      refreshTelegramQueueMessage_(
        chatId,
        state.dashboardMessageId,
        new Date(state.originalDateMs || oldStart.getTime())
      );
    }

    telegramSendMessage_(chatId,
      '<b>Тренировка перенесена</b>\n' +
      escapeTelegramHtml_(String(values[9] || values[7] || 'Клиент')) + '\n' +
      escapeTelegramHtml_(
        Utilities.formatDate(newStart, timeZone, 'dd.MM.yyyy HH:mm') +
        '–' + Utilities.formatDate(newEnd, timeZone, 'HH:mm')
      ) + '\n\n' +
      'Google Calendar обновлён; Apple Calendar подтянет изменение при синхронизации.',
      null
    );
  } catch (error) {
    telegramSendMessage_(chatId,
      '<b>Не удалось перенести тренировку</b>\n' +
      escapeTelegramHtml_(error.message || String(error)) + '\n\n' +
      'Пришли дату ещё раз в формате <code>21.08 19:30</code> или нажми /cancel.',
      null
    );
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function parseTelegramMoveDate_(text, timeZone, now) {
  const match = String(text || '').trim().match(
    /^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2}|\d{4}))?\s+(\d{1,2})[:.](\d{2})$/
  );

  if (!match) {
    throw new Error('Не понял дату и время.');
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  let year = match[3]
    ? Number(match[3])
    : Number(Utilities.formatDate(now, timeZone, 'yyyy'));

  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31 ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('Некорректная дата или время.');
  }

  let parsed = Utilities.parseDate(
    [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-') +
      ' ' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0'),
    timeZone,
    'yyyy-MM-dd HH:mm'
  );

  if (!match[3] && parsed.getTime() < now.getTime()) {
    year++;
    parsed = Utilities.parseDate(
      [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-') +
        ' ' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0'),
      timeZone,
      'yyyy-MM-dd HH:mm'
    );
  }

  const expected =
    String(day).padStart(2, '0') + '.' + String(month).padStart(2, '0') + '.' + year +
    ' ' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');

  if (Utilities.formatDate(parsed, timeZone, 'dd.MM.yyyy HH:mm') !== expected) {
    throw new Error('Такой даты не существует.');
  }

  if (parsed.getTime() <= now.getTime()) {
    throw new Error('Новое время должно быть в будущем.');
  }

  return parsed;
}

function applyTelegramCalendarCancellationsForDateLegacyV4_(date) {
  const lock = LockService.getDocumentLock();

  if (!lock.tryLock(10000)) {
    return {
      deleted: 0,
      alreadyMissing: 0,
      failed: 1,
      errors: ['Не удалось обновить календарь: другое действие ещё выполняется.']
    };
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
    const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
    const dateKey = makeDateKey_(date, timeZone);
    const result = {deleted: 0, alreadyMissing: 0, failed: 0, errors: []};
    const lastRow = queue.getLastRow();

    if (lastRow < DMS_TELEGRAM.QUEUE_FIRST_ROW) return result;

    const rows = queue.getRange(
      DMS_TELEGRAM.QUEUE_FIRST_ROW,
      1,
      lastRow - DMS_TELEGRAM.QUEUE_FIRST_ROW + 1,
      DMS_TELEGRAM.QUEUE_COLUMNS
    ).getValues();

    rows.forEach(function(values, index) {
      if (!(values[1] instanceof Date) ||
          makeDateKey_(values[1], timeZone) !== dateKey ||
          values[13] !== 'Обработано' ||
          values[15] !== 'Telegram' ||
          ['Отмена со списанием', 'Отмена без списания'].indexOf(values[12]) === -1) {
        return;
      }

      const calendarId = String(values[2] || '').trim();
      const eventId = String(values[3] || '').trim();
      const queueId = String(values[0] || '').trim();
      const rowNumber = DMS_TELEGRAM.QUEUE_FIRST_ROW + index;

      if (!calendarId || !eventId ||
          String(values[16] || '').indexOf('Событие удалено через Telegram') !== -1) {
        return;
      }

      try {
        Calendar.Events.remove(calendarId, eventId, {sendUpdates: 'none'});
        result.deleted++;
        values[16] = mergeQueueComment_(
          values[16],
          'Событие удалено через Telegram'
        );
      } catch (error) {
        if (isCalendarEventMissingError_(error)) {
          result.alreadyMissing++;
          values[16] = mergeQueueComment_(
            values[16],
            'Событие уже отсутствует в Google Calendar'
          );
        } else {
          result.failed++;
          result.errors.push(queueId + ': ' + (error.message || String(error)));
          values[13] = 'Ошибка';
          values[16] = mergeQueueComment_(
            values[16],
            'Учёт выполнен, но событие не удалено из Google Calendar: ' +
              (error.message || String(error))
          );
        }
      }

      queue
        .getRange(rowNumber, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS)
        .setValues([values]);
    });

    return result;
  } finally {
    lock.releaseLock();
  }
}

function buildTelegramDayConfirmationText_(date, result, calendarResult) {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const dateKey = makeDateKey_(date, timeZone);
  const title = Utilities.formatDate(date, timeZone, 'dd.MM.yyyy');
  const processed = [];
  const pending = [];
  const now = new Date();
  const lastRow = queue.getLastRow();

  if (lastRow >= DMS_TELEGRAM.QUEUE_FIRST_ROW) {
    queue.getRange(
      DMS_TELEGRAM.QUEUE_FIRST_ROW,
      1,
      lastRow - DMS_TELEGRAM.QUEUE_FIRST_ROW + 1,
      DMS_TELEGRAM.QUEUE_COLUMNS
    ).getValues().forEach(function(row) {
      if (!(row[1] instanceof Date) || makeDateKey_(row[1], timeZone) !== dateKey) return;

      const time = row[5] instanceof Date
        ? Utilities.formatDate(row[5], timeZone, 'HH:mm')
        : '—';
      const client = String(row[9] || row[7] || 'Не распознано');
      const line = '<b>' + escapeTelegramHtml_(time) + '</b> ' +
        escapeTelegramHtml_(client) + ' — ';

      if (row[13] === 'Обработано') {
        processed.push(line + escapeTelegramHtml_(describeTelegramProcessedDecision_(row)));
      } else {
        pending.push(line + escapeTelegramHtml_(
          describeTelegramPendingQueueRow_(row, now, timeZone)
        ));
      }
    });
  }

  const lines = [
    '<b>День обработан</b>',
    escapeTelegramHtml_(title),
    '',
    '<b>Учтено за день</b>'
  ];

  lines.push(processed.length ? '• ' + processed.join('\n• ') : '• Пока ничего.');
  lines.push('', '<b>Остались на день</b>');
  lines.push(pending.length ? '• ' + pending.join('\n• ') : '• Ничего. День закрыт полностью.');

  if (calendarResult && calendarResult.failed) {
    lines.push(
      '',
      '<b>Календарь требует внимания</b>',
      '• ' + calendarResult.errors.map(escapeTelegramHtml_).join('\n• ')
    );
  }

  return lines.join('\n');
}

function describeTelegramProcessedDecision_(row) {
  const decision = String(row[12] || '');
  const comment = String(row[16] || '');
  const removed = comment.indexOf('Событие удалено через Telegram') !== -1;
  const missing = comment.indexOf('Событие уже отсутствует в Google Calendar') !== -1;
  const labels = {
    'Проведена': '✅ проведена',
    'Не учитывать': '➖ не учитывается'
  };

  if (decision === 'Отмена со списанием') {
    return '💸 отмена со списанием' +
      (removed ? '; событие удалено' : (missing ? '; события уже не было' : ''));
  }

  if (decision === 'Отмена без списания') {
    return '🚫 отмена без списания' +
      (removed ? '; событие удалено' : (missing ? '; события уже не было' : ''));
  }

  return labels[decision] || 'обработана';
}

function describeTelegramPendingQueueRow_(row, now, timeZone) {
  if (row[6] instanceof Date && row[6] > now &&
      ['Проведена', 'Отмена со списанием'].indexOf(String(row[12] || '')) !== -1) {
    return '⏳ ещё не завершилась; закончится в ' +
      Utilities.formatDate(row[6], timeZone, 'HH:mm');
  }

  if (row[12] === 'Перенос') return '↔️ ожидает нового времени';
  if (row[11] !== 'Распознано') return '⚠️ клиент не распознан';

  const comments = String(row[16] || '').split(' | ').filter(Boolean);
  return '⚠️ ' + (comments.length ? comments[comments.length - 1] : 'требует проверки');
}

function telegramHelpTextLegacyV4_() {
  return [
    '<b>Команды</b>',
    '/today — подтвердить сегодняшний день',
    '/yesterday — проверить вчерашний день',
    '/balances — остатки тренировок',
    '/debt — долги клиентов',
    '/report — отчёт за выбранный месяц',
    '/cancel — отменить начатый перенос'
  ].join('\n');
}



function inspectDmsDataSchema() {
  const ss = SpreadsheetApp.getActive();
  ['Клиенты', 'Блоки', 'Оплаты', 'Журнал тренировок'].forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      console.log(name + ': лист отсутствует');
      return;
    }
    const width = Math.max(1, Math.min(sheet.getLastColumn(), 24));
    const height = Math.max(1, Math.min(sheet.getFrozenRows() || 6, 8));
    console.log(name + ': ' + JSON.stringify(sheet.getRange(1, 1, height, width).getDisplayValues()));
  });
  return 'Схема выведена в журнал выполнения.';
}

// DMS Telegram client cards and payments extension v5.
const DMS_TELEGRAM_CLIENTS = {
  BLOCKS: 'Блоки',
  PAYMENTS: 'Оплаты',
  CLIENT_COLUMNS: 14,
  CLIENTS_PER_PAGE: 8,
  PAYMENT_FIRST_ROW: 4,
  PAYMENT_COLUMNS: 10,
  PAYMENT_CACHE_PREFIX: 'DMS_TG_PAYMENT_',
  PAYMENT_TTL_SECONDS: 1800
};

function handleTelegramMessageV5_(message) {
  const chatId = message.chat && message.chat.id;
  const userId = message.from && message.from.id;

  if (!isTelegramAdmin_(userId, chatId)) return;

  const text = String(message.text || '').trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const pendingMove = getTelegramMoveState_(userId, chatId);
  const pendingPayment = getTelegramPaymentState_(userId, chatId);

  if (command === '/start' || command === '/menu' || text === '🏠 Меню') {
    sendTelegramMainMenu_(chatId);
    return;
  }

  if (command === '/cancel' || text === '❌ Отменить действие') {
    if (pendingMove) {
      cancelTelegramMove_(pendingMove, userId, chatId);
      return;
    }
    if (pendingPayment) {
      clearTelegramPaymentState_(userId, chatId);
      telegramSendMessage_(chatId, 'Внесение оплаты отменено.', buildTelegramMainKeyboard_());
      return;
    }
  }

  const mainButtons = [
    '📅 Сегодня', '⏮ Вчера', '👥 Клиенты',
    '📦 Остатки', '💳 Долги', '📊 Отчёт'
  ];
  if ((pendingPayment || pendingMove) && mainButtons.indexOf(text) !== -1) {
    telegramSendMessage_(chatId,
      'Сначала заверши текущее действие или нажми «❌ Отменить действие».',
      {keyboard: [[{text: '❌ Отменить действие'}]], resize_keyboard: true}
    );
    return;
  }

  if (pendingPayment && command.charAt(0) !== '/') {
    handleTelegramPaymentAmount_(pendingPayment, userId, chatId, text);
    return;
  }

  if (pendingMove && command.charAt(0) !== '/') {
    handleTelegramMoveInput_(pendingMove, userId, chatId, text);
    return;
  }

  if (command === '/today' || command === '/day' || text === '📅 Сегодня') {
    syncCalendarToQueue();
    sendTelegramQueueDashboard_(chatId, new Date());
    return;
  }

  if (command === '/yesterday' || text === '⏮ Вчера') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    sendTelegramQueueDashboard_(chatId, date);
    return;
  }

  if (command === '/balances' || text === '📦 Остатки') {
    telegramSendMessage_(chatId, buildTelegramBalancesText_(), null);
    return;
  }

  if (command === '/clients' || text === '👥 Клиенты') {
    sendTelegramClientList_(chatId, 0, null);
    return;
  }

  if (command === '/client') {
    const query = text.substring(text.indexOf(' ') + 1).trim();
    if (!query || query === text) {
      sendTelegramClientList_(chatId, 0, null);
    } else {
      sendTelegramClientSearch_(chatId, query);
    }
    return;
  }

  if (command === '/debt' || text === '💳 Долги') {
    telegramSendMessage_(chatId, buildTelegramDebtText_(), null);
    return;
  }

  if (command === '/report' || text === '📊 Отчёт') {
    telegramSendMessage_(chatId, buildTelegramReportText_(), null);
    return;
  }

  if (command === '/chatid') {
    telegramSendMessage_(chatId,
      'User ID: <code>' + escapeTelegramHtml_(userId) + '</code>\n' +
      'Chat ID: <code>' + escapeTelegramHtml_(chatId) + '</code>',
      null
    );
    return;
  }

  telegramSendMessage_(chatId, telegramHelpText_(), null);
}

function buildTelegramMainKeyboardLegacyV5_() {
  return {
    keyboard: [
      [{text: '📅 Сегодня'}, {text: '⏮ Вчера'}],
      [{text: '👥 Клиенты'}, {text: '📦 Остатки'}],
      [{text: '💳 Долги'}, {text: '📊 Отчёт'}],
      [{text: '🏠 Меню'}]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Выбери действие'
  };
}

function sendTelegramMainMenu_(chatId) {
  telegramSendMessage_(chatId,
    '<b>DMS Fitness</b>\nВыбери действие кнопкой ниже.',
    buildTelegramMainKeyboard_()
  );
}

function handleTelegramCallbackLegacyV5_(query) {
  const message = query.message || {};
  const chatId = message.chat && message.chat.id;
  const userId = query.from && query.from.id;

  if (!isTelegramAdmin_(userId, chatId)) {
    telegramAnswerCallback_(query.id, 'Нет доступа', true);
    return;
  }

  const data = String(query.data || '');

  if (data.indexOf('clp:') === 0) {
    const page = Number(data.substring(4)) || 0;
    telegramAnswerCallback_(query.id, 'Открываю список', false);
    sendTelegramClientList_(chatId, page, message.message_id);
    return;
  }

  if (data.indexOf('cl:') === 0) {
    const clientId = data.substring(3);
    telegramAnswerCallback_(query.id, 'Открываю карточку', false);
    sendTelegramClientCard_(chatId, clientId, message.message_id);
    return;
  }

  if (data.indexOf('pm:') === 0) {
    const parts = data.split(':');
    beginTelegramPayment_(userId, chatId, parts[1], parts[2]);
    telegramAnswerCallback_(query.id, 'Жду сумму', false);
    return;
  }

  if (data === 'pc:no') {
    clearTelegramPaymentState_(userId, chatId);
    telegramAnswerCallback_(query.id, 'Оплата отменена', false);
    telegramEditMessage_(chatId, message.message_id, 'Внесение оплаты отменено.', null);
    return;
  }

  if (data === 'pc:yes') {
    telegramAnswerCallback_(query.id, 'Записываю оплату…', false);
    confirmTelegramPayment_(userId, chatId, message.message_id);
    return;
  }

  if (data.indexOf('qd:') === 0) {
    const parts = data.split(':');
    const queueId = parts[1];
    const decisionCode = parts[2];
    const result = setTelegramQueueDecision_(queueId, decisionCode);

    if (decisionCode === 'move') {
      clearTelegramPaymentState_(userId, chatId);
      startTelegramMove_(userId, chatId, message.message_id, result);
      telegramAnswerCallback_(query.id, 'Жду новую дату и время', false);
      refreshTelegramQueueMessage_(chatId, message.message_id, result.date);
      return;
    }

    clearTelegramMoveState_(userId, chatId);
    telegramAnswerCallback_(query.id, result.notice, false);
    refreshTelegramQueueMessage_(chatId, message.message_id, result.date);
    return;
  }

  if (data.indexOf('qp:') === 0) {
    const dateKey = data.substring(3);
    telegramAnswerCallback_(query.id, 'Обрабатываю день…', false);

    try {
      syncCalendarToQueue();
      const date = parseTelegramDateKey_(dateKey);
      activateStartedPlannedBlocksForDate_(date);
      const result = processQueueDate_(date, 'Telegram', false);
      const calendarResult = applyTelegramCalendarCancellationsForDate_(date);
      const text = buildTelegramDayConfirmationText_(date, result, calendarResult) +
        buildTelegramWarningsText_();

      telegramEditMessage_(chatId, message.message_id, text, null);
    } catch (error) {
      telegramSendMessage_(chatId,
        '<b>Не удалось подтвердить день</b>\n' +
        escapeTelegramHtml_(error.message || String(error)),
        null
      );
    }
    return;
  }

  if (data.indexOf('qr:') === 0) {
        const date = parseTelegramDateKey_(data.substring(3));
    telegramAnswerCallback_(query.id, 'Обновляю…', false);
    syncCalendarToQueue();
    refreshTelegramQueueMessage_(chatId, message.message_id, date);
    return;
  }

  telegramAnswerCallback_(query.id, 'Команда устарела', false);
}

function getTelegramActiveClients_() {
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM.CLIENTS);
  const lastRow = clients.getLastRow();
  const result = [];

  if (lastRow < DMS_TELEGRAM.CLIENT_FIRST_ROW) return result;

  clients.getRange(
    DMS_TELEGRAM.CLIENT_FIRST_ROW,
    1,
    lastRow - DMS_TELEGRAM.CLIENT_FIRST_ROW + 1,
    DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS
  ).getDisplayValues().forEach(function(row) {
    if (!row[0] || row[2] !== 'Активен') return;
    result.push({id: row[0], name: row[1], values: row});
  });

  result.sort(function(a, b) {
    return a.name.localeCompare(b.name, 'ru');
  });
  return result;
}

function sendTelegramClientListV5_(chatId, requestedPage, messageId) {
  const clients = getTelegramActiveClients_();
  const pageCount = Math.max(1, Math.ceil(
    clients.length / DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE
  ));
  const page = Math.max(0, Math.min(Number(requestedPage) || 0, pageCount - 1));
  const start = page * DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE;
  const visible = clients.slice(
    start,
    start + DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE
  );
  const keyboard = visible.map(function(client) {
    const rest = client.values[3] ? client.values[6] + ' тр.' : 'разовые';
    return [{
      text: client.name + ' · ' + rest,
      callback_data: 'cl:' + client.id
    }];
  });

  if (pageCount > 1) {
    const navigation = [];
    if (page > 0) navigation.push({text: '◀️', callback_data: 'clp:' + (page - 1)});
    navigation.push({text: (page + 1) + '/' + pageCount, callback_data: 'clp:' + page});
    if (page < pageCount - 1) navigation.push({text: '▶️', callback_data: 'clp:' + (page + 1)});
    keyboard.push(navigation);
  }

  const text = '<b>Клиенты</b>\n' +
    (clients.length
      ? 'Выбери клиента для открытия карточки.'
      : 'Активных клиентов нет.');
  const markup = keyboard.length ? {inline_keyboard: keyboard} : null;

  if (messageId) {
    telegramEditMessage_(chatId, messageId, text, markup);
  } else {
    telegramSendMessage_(chatId, text, markup);
  }
}

function sendTelegramClientSearch_(chatId, query) {
  const normalized = normalizeTelegramClientSearch_(query);
  const matches = getTelegramActiveClients_().filter(function(client) {
    return normalizeTelegramClientSearch_(client.name).indexOf(normalized) !== -1 ||
      normalizeTelegramClientSearch_(client.id) === normalized;
  });

  if (!matches.length) {
    telegramSendMessage_(chatId,
      'Клиент по запросу «' + escapeTelegramHtml_(query) + '» не найден.',
      null
    );
    return;
  }

  if (matches.length === 1) {
    sendTelegramClientCard_(chatId, matches[0].id, null);
    return;
  }

  telegramSendMessage_(chatId,
    '<b>Найдено несколько клиентов</b>',
    {inline_keyboard: matches.slice(0, 20).map(function(client) {
      return [{text: client.name, callback_data: 'cl:' + client.id}];
    })}
  );
}

function normalizeTelegramClientSearch_(value) {
  return String(value || '')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9-]+/gi, ' ')
    .trim();
}

function getTelegramClientCardV5_(clientId) {
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM.CLIENTS);
  const row = findRowByValue_(
    clients,
    1,
    clientId,
    DMS_TELEGRAM.CLIENT_FIRST_ROW
  );

  if (!row) throw new Error('Клиент ' + clientId + ' не найден.');

  const values = clients.getRange(
    row,
    1,
    1,
    DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS
  ).getDisplayValues()[0];

  return {
    id: values[0],
    name: values[1],
    status: values[2],
    blockId: values[3],
    format: values[4],
    completed: values[5],
    remaining: values[6],
    blockPrice: values[7],
    paid: values[8],
    debt: values[9],
    conditions: values[10]
  };
}

function buildTelegramClientCardTextV5_(card) {
  const lines = [
    '<b>' + escapeTelegramHtml_(card.name) + '</b>',
    'Статус: ' + escapeTelegramHtml_(card.status)
  ];

  if (card.blockId) {
    lines.push(
      'Блок: <b>' + escapeTelegramHtml_(card.blockId) + '</b> · ' +
        escapeTelegramHtml_(card.format || 'формат не указан'),
      'Тренировки: ' + escapeTelegramHtml_(card.completed || '0') +
        ' проведено · <b>' + escapeTelegramHtml_(card.remaining || '0') + '</b> осталось',
      'Стоимость: ' + escapeTelegramHtml_(card.blockPrice || '—'),
      'Оплачено: ' + escapeTelegramHtml_(card.paid || '0 ₽'),
      'Долг: <b>' + escapeTelegramHtml_(card.debt || '0 ₽') + '</b>'
    );
  } else {
    lines.push('Формат: разовые тренировки');
  }

  if (card.conditions) {
    lines.push('', 'Условия: ' + escapeTelegramHtml_(card.conditions));
  }
  return lines.join('\n');
}

function sendTelegramClientCardV5_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  const keyboard = [];

  if (card.blockId) {
    keyboard.push([
      {text: '💳 Перевод', callback_data: 'pm:' + card.id + ':transfer'},
      {text: '💵 Наличные', callback_data: 'pm:' + card.id + ':cash'}
    ]);
  }
  keyboard.push([
    {text: '🔄 Обновить', callback_data: 'cl:' + card.id},
    {text: '🔙 Клиенты', callback_data: 'clp:0'}
  ]);

  const text = buildTelegramClientCardText_(card);
  const markup = {inline_keyboard: keyboard};
  if (messageId) {
    telegramEditMessage_(chatId, messageId, text, markup);
  } else {
    telegramSendMessage_(chatId, text, markup);
  }
}

function beginTelegramPayment_(userId, chatId, clientId, methodCode) {
  const methods = {transfer: 'Перевод', cash: 'Наличные'};
  const method = methods[methodCode];
  if (!method) throw new Error('Неизвестный способ оплаты.');

  const card = getTelegramClientCard_(clientId);
  if (!card.blockId) {
    throw new Error('У клиента нет активного блока.');
  }

  clearTelegramMoveState_(userId, chatId);
  putTelegramPaymentState_(userId, chatId, {
    phase: 'amount',
    clientId: card.id,
    clientName: card.name,
    blockId: card.blockId,
    method: method
  });

  telegramSendMessage_(chatId,
    '<b>Оплата: ' + escapeTelegramHtml_(card.name) + '</b>\n' +
    'Блок: ' + escapeTelegramHtml_(card.blockId) + '\n' +
    'Способ: ' + escapeTelegramHtml_(method) + '\n\n' +
    'Пришли сумму одним сообщением, например: <code>30000</code>\n' +
    '/cancel — отменить.',
    {
      force_reply: true,
      selective: true,
      input_field_placeholder: '30000'
    }
  );
}

function handleTelegramPaymentAmount_(state, userId, chatId, text) {
  if (state.phase !== 'amount') {
    telegramSendMessage_(chatId, 'Сначала подтверди или отмени предыдущую оплату.', null);
    return;  }

  const amount = parseTelegramMoney_(text);
  if (!amount || amount <= 0 || amount > 1000000) {
    telegramSendMessage_(chatId,
      'Не понял сумму. Пришли число от 1 до 1 000 000, например <code>30000</code>.',
      null
    );
    return;
  }

  state.phase = 'confirm';
  state.amount = amount;
  putTelegramPaymentState_(userId, chatId, state);

  telegramSendMessage_(chatId,
    '<b>Проверь оплату</b>\n' +
    'Клиент: ' + escapeTelegramHtml_(state.clientName) + '\n' +
    'Блок: ' + escapeTelegramHtml_(state.blockId) + '\n' +
    'Сумма: <b>' + escapeTelegramHtml_(formatTelegramMoney_(amount)) + '</b>\n' +
    'Способ: ' + escapeTelegramHtml_(state.method) + '\n' +
    'Дата: сегодня',
    {inline_keyboard: [[
      {text: '✅ Записать', callback_data: 'pc:yes'},
      {text: '❌ Отмена', callback_data: 'pc:no'}
    ]]}
  );
}

function confirmTelegramPayment_(userId, chatId, messageId) {
  const state = getTelegramPaymentState_(userId, chatId);
  if (!state || state.phase !== 'confirm') {
    telegramEditMessage_(chatId, messageId,
      'Срок подтверждения истёк. Начни внесение оплаты заново.',
      null
    );
    return;
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  }

  try {
    const card = getTelegramClientCard_(state.clientId);
    if (card.blockId !== state.blockId) {
      throw new Error('Активный блок клиента изменился. Оплата не записана.');
    }

    const operationId = appendTelegramPayment_(state);
    clearTelegramPaymentState_(userId, chatId);
    const updated = getTelegramClientCard_(state.clientId);

    telegramEditMessage_(chatId, messageId,
      '<b>Оплата записана</b>\n' +
      'Операция: ' + escapeTelegramHtml_(operationId) + '\n' +
      'Клиент: ' + escapeTelegramHtml_(state.clientName) + '\n' +
      'Сумма: <b>' + escapeTelegramHtml_(formatTelegramMoney_(state.amount)) + '</b>\n' +
      'Долг после оплаты: <b>' + escapeTelegramHtml_(updated.debt || '0 ₽') + '</b>',
      {inline_keyboard: [[
        {text: '👤 Карточка клиента', callback_data: 'cl:' + state.clientId},
        {text: '🔙 Клиенты', callback_data: 'clp:0'}
      ]]}
    );
  } catch (error) {
    telegramSendMessage_(chatId,
      '<b>Оплата не записана</b>\n' +
      escapeTelegramHtml_(error.message || String(error)),
      null
    );
  } finally {
    lock.releaseLock();
  }
}

function appendTelegramPaymentLegacyV5_(state) {
  const ss = SpreadsheetApp.getActive();
  const payments = getRequiredSheet_(ss, DMS_TELEGRAM_CLIENTS.PAYMENTS);
  const row = findTelegramEmptyPaymentRow_(payments);
  const operationId = makeNextTelegramPaymentId_(payments);
  const now = new Date();

  if (payments.getLastRow() >= DMS_TELEGRAM_CLIENTS.PAYMENT_FIRST_ROW) {
    const template = payments.getRange(
      DMS_TELEGRAM_CLIENTS.PAYMENT_FIRST_ROW,
      1,
      1,
      DMS_TELEGRAM_CLIENTS.PAYMENT_COLUMNS
    );
    const target = payments.getRange(
      row,
      1,
      1,
      DMS_TELEGRAM_CLIENTS.PAYMENT_COLUMNS
    );
    template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    template.copyTo(
      target,
      SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION,
      false
    );
  }

  payments.getRange(
    row,
    1,
    1,
    DMS_TELEGRAM_CLIENTS.PAYMENT_COLUMNS
  ).setValues([[
    operationId,
    now,
    state.clientId,
    state.blockId,
    'Оплата',
    state.method,
    Number(state.amount),
    'Подтверждён',
    now,
    'Внесено через Telegram'
  ]]);

  SpreadsheetApp.flush();
  return operationId;
}

function findTelegramEmptyPaymentRow_(sheet) {
  const first = DMS_TELEGRAM_CLIENTS.PAYMENT_FIRST_ROW;
  const last = Math.max(sheet.getLastRow(), first - 1);
  if (last < first) return first;

  const ids = sheet.getRange(first, 1, last - first + 1, 1).getDisplayValues();
  for (let index = 0; index < ids.length; index++) {
    if (!String(ids[index][0] || '').trim()) return first + index;
  }
  return last + 1;
}

function makeNextTelegramPaymentId_(sheet) {
  const first = DMS_TELEGRAM_CLIENTS.PAYMENT_FIRST_ROW;
  const last = sheet.getLastRow();
  let next = 1;

  if (last >= first) {
    sheet.getRange(first, 1, last - first + 1, 1)
      .getDisplayValues()
      .forEach(function(row) {
        const match = String(row[0] || '').match(/^OP-(\d+)$/);
        if (match) next = Math.max(next, Number(match[1]) + 1);
      });
  }
  return 'OP-' + String(next).padStart(3, '0');
}

function makeTelegramPaymentCacheKey_(userId, chatId) {
  return DMS_TELEGRAM_CLIENTS.PAYMENT_CACHE_PREFIX +
    String(userId) + '_' + String(chatId);
}

function putTelegramPaymentState_(userId, chatId, state) {
  CacheService.getScriptCache().put(
    makeTelegramPaymentCacheKey_(userId, chatId),
    JSON.stringify(state),
    DMS_TELEGRAM_CLIENTS.PAYMENT_TTL_SECONDS
  );
}

function getTelegramPaymentState_(userId, chatId) {
  const raw = CacheService.getScriptCache().get(
    makeTelegramPaymentCacheKey_(userId, chatId)
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (ignore) {
    clearTelegramPaymentState_(userId, chatId);
    return null;
  }
}

function clearTelegramPaymentState_(userId, chatId) {
  CacheService.getScriptCache().remove(
    makeTelegramPaymentCacheKey_(userId, chatId)
  );
}

function formatTelegramMoney_(amount) {
  return Number(amount || 0).toLocaleString('ru-RU') + ' ₽';
}

function telegramHelpTextLegacyV5_() {
  return [
    '<b>Основные действия доступны кнопками внизу.</b>',
    '',
    '<b>Команды на случай ручного ввода</b>',
    '/menu — показать кнопки',
    '/today — подтвердить сегодняшний день',
    '/yesterday — проверить вчерашний день',
    '/clients — карточки клиентов и оплаты',
    '/client имя — найти клиента',
    '/balances — остатки тренировок',
    '/debt — долги клиентов',
    '/report — отчёт за выбранный месяц',
    '/cancel — отменить перенос или внесение оплаты'
  ].join('\n');
}


// DMS Telegram calendar scheduling and block history extension v6.
const DMS_TELEGRAM_SCHEDULING = {
  SETTINGS: 'Настройки',
  LOG: 'Журнал тренировок',
  LOG_FIRST_ROW: 4,
  LOG_COLUMNS: 19,
  CACHE_PREFIX: 'DMS_TG_SCHEDULE_',
  CACHE_TTL_SECONDS: 1800,
  CLIENTS_PER_PAGE: 8
};

function handleTelegramMessageV6_(message) {
  const chatId = message.chat && message.chat.id;
  const userId = message.from && message.from.id;

  if (!isTelegramAdmin_(userId, chatId)) return;

  const text = String(message.text || '').trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const pendingMove = getTelegramMoveState_(userId, chatId);
  const pendingPayment = getTelegramPaymentState_(userId, chatId);
  const pendingSchedule = getTelegramScheduleState_(userId, chatId);

  if (command === '/start' || command === '/menu' || text === '🏠 Меню') {
    sendTelegramMainMenu_(chatId);
    return;
  }

  if (command === '/cancel' || text === '❌ Отменить действие') {
    if (pendingMove) {
      cancelTelegramMove_(pendingMove, userId, chatId);
      return;
    }
    if (pendingPayment) clearTelegramPaymentState_(userId, chatId);
    if (pendingSchedule) clearTelegramScheduleState_(userId, chatId);

    telegramSendMessage_(chatId, 'Текущее действие отменено.', buildTelegramMainKeyboard_());
    return;
  }

  const mainButtons = [
    '📅 Сегодня', '⏮ Вчера', '➕ Записать', '👥 Клиенты',
    '📦 Остатки', '💳 Долги', '📊 Отчёт'
  ];
  if ((pendingPayment || pendingMove || pendingSchedule) &&
      mainButtons.indexOf(text) !== -1) {
    telegramSendMessage_(chatId,
      'Сначала заверши текущее действие или нажми «❌ Отменить действие».',
      {keyboard: [[{text: '❌ Отменить действие'}]], resize_keyboard: true}
    );
    return;
  }

  if (pendingSchedule && command.charAt(0) !== '/') {
    handleTelegramScheduleInput_(pendingSchedule, userId, chatId, text);
    return;
  }

  if (pendingPayment && command.charAt(0) !== '/') {
    handleTelegramPaymentAmount_(pendingPayment, userId, chatId, text);
    return;
  }

  if (pendingMove && command.charAt(0) !== '/') {
    handleTelegramMoveInput_(pendingMove, userId, chatId, text);
    return;
  }

  if (command === '/today' || command === '/day' || text === '📅 Сегодня') {
    syncCalendarToQueue();
    sendTelegramQueueDashboard_(chatId, new Date());
    return;
  }

  if (command === '/yesterday' || text === '⏮ Вчера') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    sendTelegramQueueDashboard_(chatId, date);
    return;
  }

  if (command === '/schedule' || text === '➕ Записать') {
    sendTelegramScheduleClientList_(chatId, 0, null);
    return;
  }

  if (command === '/balances' || text === '📦 Остатки') {
    telegramSendMessage_(chatId, buildTelegramBalancesText_(), null);
    return;
  }

  if (command === '/clients' || text === '👥 Клиенты') {
    sendTelegramClientList_(chatId, 0, null);
    return;
  }

  if (command === '/client') {
    const query = text.substring(text.indexOf(' ') + 1).trim();
    if (!query || query === text) {
      sendTelegramClientList_(chatId, 0, null);
    } else {
      sendTelegramClientSearch_(chatId, query);
    }
    return;
  }

  if (command === '/debt' || text === '💳 Долги') {
    telegramSendMessage_(chatId, buildTelegramDebtText_(), null);
    return;
  }

  if (command === '/report' || text === '📊 Отчёт') {
    telegramSendMessage_(chatId, buildTelegramReportText_(), null);
    return;
  }

  if (command === '/chatid') {
    telegramSendMessage_(chatId,
      'User ID: <code>' + escapeTelegramHtml_(userId) + '</code>\n' +
      'Chat ID: <code>' + escapeTelegramHtml_(chatId) + '</code>',
      null
    );
    return;
  }

  telegramSendMessage_(chatId, telegramHelpText_(), buildTelegramMainKeyboard_());
}

function handleTelegramCallbackV6_(query) {
  const message = query.message || {};
  const chatId = message.chat && message.chat.id;
  const userId = query.from && query.from.id;

  if (!isTelegramAdmin_(userId, chatId)) {
    telegramAnswerCallback_(query.id, 'Нет доступа', true);
    return;
  }

  const data = String(query.data || '');

  if (data.indexOf('slp:') === 0) {
    telegramAnswerCallback_(query.id, 'Открываю список', false);
    sendTelegramScheduleClientList_(
      chatId,
      Number(data.substring(4)) || 0,
      message.message_id
    );
    return;
  }

  if (data.indexOf('sc:') === 0) {
    clearTelegramPaymentState_(userId, chatId);
    clearTelegramMoveState_(userId, chatId);
    startTelegramSchedule_(
      userId,
      chatId,
      data.substring(3),
      message.message_id
    );
    telegramAnswerCallback_(query.id, 'Выбери дату', false);
    return;
  }

  if (data.indexOf('sdt:') === 0) {
    telegramAnswerCallback_(query.id, 'Дата выбрана', false);
    setTelegramScheduleDate_(
      userId,
      chatId,
      data.substring(4),
      message.message_id
    );
    return;
  }

  if (data.indexOf('sdu:') === 0) {
    telegramAnswerCallback_(query.id, 'Длительность выбрана', false);
    setTelegramScheduleDuration_(
      userId,
      chatId,
      Number(data.substring(4)),
      message.message_id
    );
    return;
  }

  if (data === 'scc:no') {
    clearTelegramScheduleState_(userId, chatId);
    telegramAnswerCallback_(query.id, 'Запись отменена', false);
    telegramEditMessage_(chatId, message.message_id, 'Создание тренировки отменено.', null);
    return;
  }

  if (data === 'scc:yes' || data === 'scc:force') {
    telegramAnswerCallback_(query.id, 'Создаю событие…', false);
    confirmTelegramSchedule_(
      userId,
      chatId,
      message.message_id,
      data === 'scc:force'
    );
    return;
  }

  if (data.indexOf('clp:') === 0) {
    const page = Number(data.substring(4)) || 0;
    telegramAnswerCallback_(query.id, 'Открываю список', false);
    sendTelegramClientList_(chatId, page, message.message_id);
    return;
  }

  if (data.indexOf('cl:') === 0) {
    const clientId = data.substring(3);
    telegramAnswerCallback_(query.id, 'Открываю карточку', false);
    sendTelegramClientCard_(chatId, clientId, message.message_id);
    return;
  }

  if (data.indexOf('pm:') === 0) {
    const parts = data.split(':');
    clearTelegramScheduleState_(userId, chatId);
    beginTelegramPayment_(userId, chatId, parts[1], parts[2]);
    telegramAnswerCallback_(query.id, 'Жду сумму', false);
    return;
  }

  if (data === 'pc:no') {
    clearTelegramPaymentState_(userId, chatId);
    telegramAnswerCallback_(query.id, 'Оплата отменена', false);
    telegramEditMessage_(chatId, message.message_id, 'Внесение оплаты отменено.', null);
    return;
  }

  if (data === 'pc:yes') {
    telegramAnswerCallback_(query.id, 'Записываю оплату…', false);
    confirmTelegramPayment_(userId, chatId, message.message_id);
    return;
  }

  if (data.indexOf('qd:') === 0) {
    const parts = data.split(':');
    const queueId = parts[1];
    const decisionCode = parts[2];
    const result = setTelegramQueueDecision_(queueId, decisionCode);

    if (decisionCode === 'move') {
      clearTelegramPaymentState_(userId, chatId);
      clearTelegramScheduleState_(userId, chatId);
      startTelegramMove_(userId, chatId, message.message_id, result);
      telegramAnswerCallback_(query.id, 'Жду новую дату и время', false);
      refreshTelegramQueueMessage_(chatId, message.message_id, result.date);
      return;
    }

    clearTelegramMoveState_(userId, chatId);
    telegramAnswerCallback_(query.id, result.notice, false);
    refreshTelegramQueueMessage_(chatId, message.message_id, result.date);
    return;
  }

  if (data.indexOf('qp:') === 0) {
    const dateKey = data.substring(3);
    telegramAnswerCallback_(query.id, 'Обрабатываю день…', false);

    try {
      syncCalendarToQueue();
      const date = parseTelegramDateKey_(dateKey);
      activateStartedPlannedBlocksForDate_(date);
      const result = processQueueDate_(date, 'Telegram', false);
      const calendarResult = applyTelegramCalendarCancellationsForDate_(date);
      const text = buildTelegramDayConfirmationText_(date, result, calendarResult) +
        buildTelegramWarningsText_();

      telegramEditMessage_(chatId, message.message_id, text, null);
    } catch (error) {
      telegramSendMessage_(chatId,
        '<b>Не удалось подтвердить день</b>\n' +
        escapeTelegramHtml_(error.message || String(error)),
        null
      );
    }
    return;
  }

  if (data.indexOf('qr:') === 0) {
    const date = parseTelegramDateKey_(data.substring(3));
    telegramAnswerCallback_(query.id, 'Обновляю…', false);
    syncCalendarToQueue();
    refreshTelegramQueueMessage_(chatId, message.message_id, date);
    return;
  }

  telegramAnswerCallback_(query.id, 'Команда устарела', false);
}

function buildTelegramMainKeyboardLegacyV6_() {
  return {
    keyboard: [
      [{text: '📅 Сегодня'}, {text: '⏮ Вчера'}],
      [{text: '➕ Записать'}],
      [{text: '👥 Клиенты'}, {text: '📦 Остатки'}],
      [{text: '💳 Долги'}, {text: '📊 Отчёт'}],
      [{text: '🏠 Меню'}]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Выбери действие'
  };
}

function getTelegramClientCardLegacyV6_(clientId) {
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM.CLIENTS);
  const row = findRowByValue_(
    clients,
    1,
    clientId,
    DMS_TELEGRAM.CLIENT_FIRST_ROW
  );

  if (!row) throw new Error('Клиент ' + clientId + ' не найден.');

  const values = clients.getRange(
    row,
    1,
    1,
    DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS
  ).getDisplayValues()[0];
  const history = getTelegramBlockTrainingHistory_(values[0], values[3]);

  return {
    id: values[0],
    name: values[1],
    status: values[2],
    blockId: values[3],
    format: values[4],
    completed: values[5],
    remaining: values[6],
    blockPrice: values[7],
    paid: values[8],
    debt: values[9],
    conditions: values[10],
    calendarTitle: values[12] || values[1] + ' ПТ',
    trainingDates: history.dates,
    undatedTrainings: history.undated
  };
}

function getTelegramBlockTrainingHistoryLegacyV6_(clientId, blockId) {
  const result = {dates: [], undated: 0};
  if (!clientId || !blockId) return result;

  const ss = SpreadsheetApp.getActive();
  const log = getRequiredSheet_(ss, DMS_TELEGRAM_SCHEDULING.LOG);
  const lastRow = log.getLastRow();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';

  if (lastRow < DMS_TELEGRAM_SCHEDULING.LOG_FIRST_ROW) return result;

  log.getRange(
    DMS_TELEGRAM_SCHEDULING.LOG_FIRST_ROW,
    1,
    lastRow - DMS_TELEGRAM_SCHEDULING.LOG_FIRST_ROW + 1,
    DMS_TELEGRAM_SCHEDULING.LOG_COLUMNS
  ).getValues().forEach(function(row) {
    if (String(row[2] || '') !== String(clientId)) return;
    if (String(row[3] || '') !== String(blockId)) return;
    if (String(row[6] || '') !== 'Проведена') return;
    if (String(row[5] || '') !== 'Фактически проведена') return;

    if (row[1] instanceof Date && !isNaN(row[1].getTime())) {
      result.dates.push({
        timestamp: row[1].getTime(),
        text: Utilities.formatDate(row[1], timeZone, 'dd.MM')
      });
    } else {
      result.undated++;
    }
  });

  result.dates.sort(function(a, b) { return a.timestamp - b.timestamp; });
  result.dates = result.dates.map(function(item) { return item.text; });
  return result;
}

function buildTelegramClientCardTextLegacyV6_(card) {
  const lines = [
    '<b>' + escapeTelegramHtml_(card.name) + '</b>',
    'Статус: ' + escapeTelegramHtml_(card.status)
  ];

  if (card.blockId) {
    lines.push(
      'Блок: <b>' + escapeTelegramHtml_(card.blockId) + '</b> · ' +
        escapeTelegramHtml_(card.format || 'формат не указан'),
      'Тренировки: ' + escapeTelegramHtml_(card.completed || '0') +
        ' проведено · <b>' + escapeTelegramHtml_(card.remaining || '0') + '</b> осталось'
    );

    if (card.trainingDates.length) {
      lines.push('Даты: ' + escapeTelegramHtml_(card.trainingDates.join(', ')));
    }
    if (card.undatedTrainings) {
      lines.push('Без указанной даты: ' + card.undatedTrainings);
    }

    lines.push(
      'Стоимость: ' + escapeTelegramHtml_(card.blockPrice || '—'),
      'Оплачено: ' + escapeTelegramHtml_(card.paid || '0 ₽'),
      'Долг: <b>' + escapeTelegramHtml_(card.debt || '0 ₽') + '</b>'
    );
  } else {
    lines.push('Формат: разовые тренировки');
  }

  if (card.conditions) {
    lines.push('', 'Условия: ' + escapeTelegramHtml_(card.conditions));
  }
  return lines.join('\n');
}

function sendTelegramClientCardLegacyV6_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  const keyboard = [[
    {text: '➕ Записать тренировку', callback_data: 'sc:' + card.id}
  ]];

  if (card.blockId) {
    keyboard.push([
      {text: '💳 Перевод', callback_data: 'pm:' + card.id + ':transfer'},
      {text: '💵 Наличные', callback_data: 'pm:' + card.id + ':cash'}
    ]);
  }
  keyboard.push([
    {text: '🔄 Обновить', callback_data: 'cl:' + card.id},
    {text: '🔙 Клиенты', callback_data: 'clp:0'}
  ]);

  const text = buildTelegramClientCardText_(card);
  const markup = {inline_keyboard: keyboard};
  if (messageId) {
    telegramEditMessage_(chatId, messageId, text, markup);
  } else {
    telegramSendMessage_(chatId, text, markup);
  }
}

function sendTelegramScheduleClientList_(chatId, requestedPage, messageId) {
  const clients = getTelegramActiveClients_();
  const pageCount = Math.max(1, Math.ceil(
    clients.length / DMS_TELEGRAM_SCHEDULING.CLIENTS_PER_PAGE
  ));
  const page = Math.max(0, Math.min(Number(requestedPage) || 0, pageCount - 1));
  const start = page * DMS_TELEGRAM_SCHEDULING.CLIENTS_PER_PAGE;
  const visible = clients.slice(
    start,
    start + DMS_TELEGRAM_SCHEDULING.CLIENTS_PER_PAGE
  );
  const keyboard = visible.map(function(client) {
    return [{text: client.name, callback_data: 'sc:' + client.id}];
  });

  if (pageCount > 1) {
    const navigation = [];
    if (page > 0) navigation.push({text: '◀️', callback_data: 'slp:' + (page - 1)});
    navigation.push({text: (page + 1) + '/' + pageCount, callback_data: 'slp:' + page});
    if (page < pageCount - 1) navigation.push({text: '▶️', callback_data: 'slp:' + (page + 1)});
    keyboard.push(navigation);
  }

  const text = '<b>Новая тренировка</b>\nВыбери клиента.';
  const markup = {inline_keyboard: keyboard};
  if (messageId) {
    telegramEditMessage_(chatId, messageId, text, markup);
  } else {
    telegramSendMessage_(chatId, text, markup);
  }
}

function startTelegramSchedule_(userId, chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  const state = {
    phase: 'date',
    clientId: card.id,
    clientName: card.name,
    calendarTitle: card.calendarTitle
  };

  putTelegramScheduleState_(userId, chatId, state);
  sendTelegramScheduleDatePicker_(chatId, messageId, state);
}

function sendTelegramScheduleDatePicker_(chatId, messageId, state) {
  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const dates = [0, 1, 2].map(function(offset) {
    const date = getTelegramScheduleDateOffset_(offset, timeZone);
    return Utilities.formatDate(date, timeZone, 'dd.MM');
  });
  const markup = {inline_keyboard: [
    [
      {text: 'Сегодня ' + dates[0], callback_data: 'sdt:0'},
      {text: 'Завтра ' + dates[1], callback_data: 'sdt:1'}
    ],
    [
      {text: dates[2], callback_data: 'sdt:2'},
      {text: 'Другая дата', callback_data: 'sdt:x'}
    ],
    [{text: '❌ Отмена', callback_data: 'scc:no'}]
  ]};
  const text = '<b>Новая тренировка: ' +
    escapeTelegramHtml_(state.clientName) + '</b>\nВыбери дату.';

  if (messageId) {
    telegramEditMessage_(chatId, messageId, text, markup);
  } else {
    telegramSendMessage_(chatId, text, markup);
  }
}

function setTelegramScheduleDate_(userId, chatId, dateCode, messageId) {
  const state = getRequiredTelegramScheduleState_(userId, chatId);
  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';

  if (dateCode === 'x') {
    state.phase = 'customDate';
    putTelegramScheduleState_(userId, chatId, state);
    telegramEditMessage_(chatId, messageId,
      '<b>Новая тренировка: ' + escapeTelegramHtml_(state.clientName) + '</b>\n' +
      'Пришли дату: <code>25.08</code> или <code>25.08.2026</code>.\n' +
      '❌ Отменить действие — кнопка внизу.',
      null
    );
    return;
  }

  const offset = Number(dateCode);
  if (!isFinite(offset) || offset < 0 || offset > 2) {
    throw new Error('Некорректная дата.');
  }

  const date = getTelegramScheduleDateOffset_(offset, timeZone);
  state.dateKey = Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
  askTelegramScheduleTime_(userId, chatId, state, messageId);
}

function getTelegramScheduleDateOffset_(offset, timeZone) {
  const todayKey = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  const today = Utilities.parseDate(
    todayKey + ' 12:00',
    timeZone,
    'yyyy-MM-dd HH:mm'
  );
  return new Date(today.getTime() + Number(offset || 0) * 24 * 60 * 60 * 1000);
}

function handleTelegramScheduleInput_(state, userId, chatId, text) {
  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';

  if (state.phase === 'customDate') {
    const date = parseTelegramScheduleDate_(text, timeZone, new Date());
    state.dateKey = Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
    askTelegramScheduleTime_(userId, chatId, state, null);
    return;
  }

  if (state.phase === 'time') {
    const start = parseTelegramScheduleTime_(state.dateKey, text, timeZone);
    if (start.getTime() < Date.now()) {
      telegramSendMessage_(chatId, 'Это время уже прошло. Пришли другое время.', null);
      return;
    }

    state.startMs = start.getTime();
    state.phase = 'duration';
    putTelegramScheduleState_(userId, chatId, state);
    telegramSendMessage_(chatId,
      '<b>Длительность тренировки</b>\n' +
      escapeTelegramHtml_(formatTelegramScheduleDateTime_(start, timeZone)),
      {inline_keyboard: [
        [
          {text: '60 минут', callback_data: 'sdu:60'},
          {text: '90 минут', callback_data: 'sdu:90'}
        ],
        [{text: '120 минут', callback_data: 'sdu:120'}],
        [{text: '❌ Отмена', callback_data: 'scc:no'}]
      ]}
    );
    return;
  }

  telegramSendMessage_(chatId,
    'Сейчас ожидается выбор кнопкой. Либо нажми «❌ Отменить действие».',
    null
  );
}

function askTelegramScheduleTime_(userId, chatId, state, messageId) {
  state.phase = 'time';
  putTelegramScheduleState_(userId, chatId, state);
  const dateText = state.dateKey.split('-').reverse().join('.');
  const text = '<b>Дата: ' + escapeTelegramHtml_(dateText) + '</b>\n' +
    'Пришли время, например <code>19:30</code>.';

  if (messageId) {
    telegramEditMessage_(chatId, messageId, text, null);
  } else {
    telegramSendMessage_(chatId, text, null);
  }
}

function setTelegramScheduleDuration_(userId, chatId, duration, messageId) {
  if ([60, 90, 120].indexOf(duration) === -1) {
    throw new Error('Некорректная длительность.');
  }

  const state = getRequiredTelegramScheduleState_(userId, chatId);
  if (!state.startMs) throw new Error('Сначала выбери дату и время.');

  state.duration = duration;
  state.phase = 'confirm';
  putTelegramScheduleState_(userId, chatId, state);
  showTelegramScheduleConfirmation_(chatId, messageId, state);
}

function showTelegramScheduleConfirmation_(chatId, messageId, state) {
  const ss = SpreadsheetApp.getActive();
  const settings = getRequiredSheet_(ss, DMS_TELEGRAM_SCHEDULING.SETTINGS);
  const config = getCalendarSyncSettings_(settings);
  const start = new Date(state.startMs);
  const end = new Date(start.getTime() + state.duration * 60000);
  const conflicts = listTelegramScheduleConflicts_(
    config.calendarId,
    start,
    end,
    config.timeZone
  );
  const lines = [
    '<b>Проверь новую тренировку</b>',
    'Клиент: ' + escapeTelegramHtml_(state.clientName),
    'Дата и время: <b>' +
      escapeTelegramHtml_(formatTelegramScheduleDateTime_(start, config.timeZone)) + '</b>',
    'Длительность: ' + state.duration + ' мин.'
  ];

  if (conflicts.length) {
    lines.push('', '<b>Есть пересечение:</b>');
    conflicts.forEach(function(conflict) {
      lines.push('• ' + escapeTelegramHtml_(conflict));
    });
  } else {
    lines.push('', 'Пересечений в календаре нет.');
  }

  const confirmText = conflicts.length ? '⚠️ Создать всё равно' : '✅ Создать';
  const confirmData = conflicts.length ? 'scc:force' : 'scc:yes';
  telegramEditMessage_(chatId, messageId, lines.join('\n'), {
    inline_keyboard: [
      [{text: confirmText, callback_data: confirmData}],
      [{text: '❌ Отмена', callback_data: 'scc:no'}]
    ]
  });
}

function confirmTelegramSchedule_(userId, chatId, messageId, allowConflict) {
  const state = getRequiredTelegramScheduleState_(userId, chatId);
  if (state.phase !== 'confirm') {
    throw new Error('Сценарий создания тренировки устарел.');
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  }

  let config;
  let start;
  let event;

  try {
    const ss = SpreadsheetApp.getActive();
    const settings = getRequiredSheet_(ss, DMS_TELEGRAM_SCHEDULING.SETTINGS);
    config = getCalendarSyncSettings_(settings);
    start = new Date(state.startMs);
    const end = new Date(start.getTime() + state.duration * 60000);
    const conflicts = listTelegramScheduleConflicts_(
      config.calendarId,
      start,
      end,
      config.timeZone
    );

    if (conflicts.length && !allowConflict) {
      showTelegramScheduleConfirmation_(chatId, messageId, state);
      return;
    }

    event = Calendar.Events.insert({
      summary: state.calendarTitle || state.clientName + ' ПТ',
      description: 'Создано через Telegram · DMS Fitness',
      start: {
        dateTime: start.toISOString(),
        timeZone: config.timeZone
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: config.timeZone
      }
    }, config.calendarId, {sendUpdates: 'none'});

    clearTelegramScheduleState_(userId, chatId);
  } finally {
    lock.releaseLock();
  }

  let syncWarning = '';
  try {
    syncCalendarToQueue();
  } catch (error) {
    syncWarning = '\n\n⚠️ Событие создано, но очередь пока не обновилась: ' +
      escapeTelegramHtml_(error.message || String(error));
  }

  const dateKey = Utilities.formatDate(start, config.timeZone, 'yyyy-MM-dd');
  telegramEditMessage_(chatId, messageId,
    '<b>Тренировка создана</b>\n' +
    escapeTelegramHtml_(state.clientName) + '\n' +
    '<b>' + escapeTelegramHtml_(
      formatTelegramScheduleDateTime_(start, config.timeZone)
    ) + '</b> · ' + state.duration + ' мин.\n\n' +
    'Событие добавлено в Google Calendar и синхронизируется с Apple Calendar.' +
    syncWarning,
    {inline_keyboard: [
      [{text: '📅 Открыть день', callback_data: 'qr:' + dateKey}],
      [{text: '👤 Карточка клиента', callback_data: 'cl:' + state.clientId}]
    ]}
  );

  return event && event.id ? event.id : '';
}

function listTelegramScheduleConflicts_(calendarId, start, end, timeZone) {
  const response = Calendar.Events.list(calendarId, {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    showDeleted: false,
    maxResults: 20,
    timeZone: timeZone
  });

  return (response.items || [])
    .filter(function(event) { return event.status !== 'cancelled'; })
    .map(function(event) {
      const title = String(event.summary || 'Событие без названия');
      if (!event.start || !event.start.dateTime) return 'весь день · ' + title;
      const eventStart = new Date(event.start.dateTime);
      const eventEnd = event.end && event.end.dateTime
        ? new Date(event.end.dateTime)
        : null;
      const range = Utilities.formatDate(eventStart, timeZone, 'HH:mm') +
        (eventEnd ? '–' + Utilities.formatDate(eventEnd, timeZone, 'HH:mm') : '');
      return range + ' · ' + title;
    });
}

function parseTelegramScheduleDate_(text, timeZone, now) {
  const match = String(text || '').trim().match(
    /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/
  );
  if (!match) throw new Error('Пришли дату в формате 25.08 или 25.08.2026.');

  const todayYear = Number(Utilities.formatDate(now, timeZone, 'yyyy'));
  const year = Number(match[3] || todayYear);
  const canonical = year + '-' +
    String(Number(match[2])).padStart(2, '0') + '-' +
    String(Number(match[1])).padStart(2, '0');
  const parsed = Utilities.parseDate(canonical + ' 12:00', timeZone, 'yyyy-MM-dd HH:mm');

  if (Utilities.formatDate(parsed, timeZone, 'yyyy-MM-dd') !== canonical) {
    throw new Error('Такой даты не существует.');
  }

  const todayKey = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd');
  if (canonical < todayKey) throw new Error('Нельзя записать тренировку в прошлом.');
  return parsed;
}

function parseTelegramScheduleTime_(dateKey, text, timeZone) {
  const match = String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error('Пришли время в формате 19:30.');

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('Такого времени не существует.');

  return Utilities.parseDate(
    dateKey + ' ' + String(hour).padStart(2, '0') + ':' +
      String(minute).padStart(2, '0'),
    timeZone,
    'yyyy-MM-dd HH:mm'
  );
}

function formatTelegramScheduleDateTime_(date, timeZone) {
  return Utilities.formatDate(date, timeZone, 'dd.MM.yyyy HH:mm');
}

function makeTelegramScheduleCacheKey_(userId, chatId) {
  return DMS_TELEGRAM_SCHEDULING.CACHE_PREFIX +
    String(userId) + '_' + String(chatId);
}

function putTelegramScheduleState_(userId, chatId, state) {
  CacheService.getScriptCache().put(
    makeTelegramScheduleCacheKey_(userId, chatId),
    JSON.stringify(state),
    DMS_TELEGRAM_SCHEDULING.CACHE_TTL_SECONDS
  );
}

function getTelegramScheduleState_(userId, chatId) {
  const raw = CacheService.getScriptCache().get(
    makeTelegramScheduleCacheKey_(userId, chatId)
  );
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (ignore) {
    clearTelegramScheduleState_(userId, chatId);
    return null;
  }
}

function getRequiredTelegramScheduleState_(userId, chatId) {
  const state = getTelegramScheduleState_(userId, chatId);
  if (!state) throw new Error('Срок создания тренировки истёк. Начни заново.');
  return state;
}

function clearTelegramScheduleState_(userId, chatId) {
  CacheService.getScriptCache().remove(
    makeTelegramScheduleCacheKey_(userId, chatId)
  );
}

function telegramHelpTextLegacyV6_() {
  return [
    '<b>Основные действия доступны кнопками внизу.</b>',
    '',
    '<b>Команды на случай ручного ввода</b>',
    '/menu — показать кнопки',
    '/schedule — записать тренировку',
    '/today — подтвердить сегодняшний день',
    '/yesterday — проверить вчерашний день',
    '/clients — карточки клиентов и оплаты',
    '/client имя — найти клиента',
    '/balances — остатки тренировок',
    '/debt — долги клиентов',
    '/report — отчёт за выбранный месяц',
    '/cancel — отменить текущее действие'
  ].join('\n');
}


// DMS Telegram charged dates display extension v7.
function getTelegramBlockTrainingHistory_(clientId, blockId) {
  const result = {dates: [], undated: 0, undatedCharged: 0};
  if (!clientId || !blockId) return result;

  const ss = SpreadsheetApp.getActive();
  const log = getRequiredSheet_(ss, DMS_TELEGRAM_SCHEDULING.LOG);
  const lastRow = log.getLastRow();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';

  if (lastRow < DMS_TELEGRAM_SCHEDULING.LOG_FIRST_ROW) return result;

  log.getRange(
    DMS_TELEGRAM_SCHEDULING.LOG_FIRST_ROW,
    1,
    lastRow - DMS_TELEGRAM_SCHEDULING.LOG_FIRST_ROW + 1,
    DMS_TELEGRAM_SCHEDULING.LOG_COLUMNS
  ).getValues().forEach(function(row) {
    if (String(row[2] || '') !== String(clientId)) return;
    if (String(row[3] || '') !== String(blockId)) return;
    if (String(row[6] || '') !== 'Проведена') return;

    const accountingType = String(row[5] || '');
    const charged = accountingType === 'Списание без проведения';
    if (!charged && accountingType !== 'Фактически проведена') return;

    if (row[1] instanceof Date && !isNaN(row[1].getTime())) {
      result.dates.push({
        timestamp: row[1].getTime(),
        text: Utilities.formatDate(row[1], timeZone, 'dd.MM') +
          (charged ? ' (списано)' : '')
      });
    } else if (charged) {
      result.undatedCharged++;
    } else {
      result.undated++;
    }
  });

  result.dates.sort(function(a, b) { return a.timestamp - b.timestamp; });
  result.dates = result.dates.map(function(item) { return item.text; });
  return result;
}

function getTelegramClientCardLegacyV7_(clientId) {
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM.CLIENTS);
  const row = findRowByValue_(
    clients,
    1,
    clientId,
    DMS_TELEGRAM.CLIENT_FIRST_ROW
  );

  if (!row) throw new Error('Клиент ' + clientId + ' не найден.');

  const values = clients.getRange(
    row,
    1,
    1,
    DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS
  ).getDisplayValues()[0];
  const history = getTelegramBlockTrainingHistory_(values[0], values[3]);

  return {
    id: values[0],
    name: values[1],
    status: values[2],
    blockId: values[3],
    format: values[4],
    completed: values[5],
    remaining: values[6],
    blockPrice: values[7],
    paid: values[8],
    debt: values[9],
    conditions: values[10],
    calendarTitle: values[12] || values[1] + ' ПТ',
    trainingDates: history.dates,
    undatedTrainings: history.undated,
    undatedCharged: history.undatedCharged
  };
}

function buildTelegramClientCardTextLegacyV7_(card) {
  const lines = [
    '<b>' + escapeTelegramHtml_(card.name) + '</b>',
    'Статус: ' + escapeTelegramHtml_(card.status)
  ];

  if (card.blockId) {
    lines.push(
      'Блок: <b>' + escapeTelegramHtml_(card.blockId) + '</b> · ' +
        escapeTelegramHtml_(card.format || 'формат не указан'),
      'Тренировки: ' + escapeTelegramHtml_(card.completed || '0') +
        ' учтено · <b>' + escapeTelegramHtml_(card.remaining || '0') + '</b> осталось'
    );

    if (card.trainingDates.length) {
      lines.push('Даты: ' + escapeTelegramHtml_(card.trainingDates.join(', ')));
    }
    if (card.undatedTrainings) {
      lines.push('Без указанной даты: ' + card.undatedTrainings);
    }
    if (card.undatedCharged) {
      lines.push('Без даты (списано): ' + card.undatedCharged);
    }

    lines.push(
      'Стоимость: ' + escapeTelegramHtml_(card.blockPrice || '—'),
      'Оплачено: ' + escapeTelegramHtml_(card.paid || '0 ₽'),
      'Долг: <b>' + escapeTelegramHtml_(card.debt || '0 ₽') + '</b>'
    );
  } else {
    lines.push('Формат: разовые тренировки');
  }

  if (card.conditions) {
    lines.push('', 'Условия: ' + escapeTelegramHtml_(card.conditions));
  }
  return lines.join('\n');
}


// DMS Telegram client and block management extension v8.
const DMS_TELEGRAM_MANAGEMENT = {
  BLOCKS: 'Блоки',
  CLIENTS: 'Клиенты',
  CLIENT_FIRST_ROW: 5,
  BLOCK_FIRST_ROW: 4,
  CLIENT_COLUMNS: 14,
  BLOCK_COLUMNS: 17,
  CACHE_PREFIX: 'DMS_TG_MANAGEMENT_',
  CACHE_TTL_SECONDS: 1800,
  MAX_NAME_LENGTH: 80,
  MAX_NOTE_LENGTH: 500
};

function handleTelegramMessageV8_(message) {
  const chatId = message.chat && message.chat.id;
  const userId = message.from && message.from.id;

  if (!isTelegramAdmin_(userId, chatId)) return;

  const text = String(message.text || '').trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const pendingMove = getTelegramMoveState_(userId, chatId);
  const pendingPayment = getTelegramPaymentState_(userId, chatId);
  const pendingSchedule = getTelegramScheduleState_(userId, chatId);
  const pendingManagement = getTelegramManagementState_(userId, chatId);

  if (command === '/start' || command === '/menu' || text === '🏠 Меню') {
    sendTelegramMainMenu_(chatId);
    return;
  }

  if (command === '/cancel' || text === '❌ Отменить действие') {
    if (pendingMove) {
      cancelTelegramMove_(pendingMove, userId, chatId);
      return;
    }
    if (pendingPayment) clearTelegramPaymentState_(userId, chatId);
    if (pendingSchedule) clearTelegramScheduleState_(userId, chatId);
    if (pendingManagement) clearTelegramManagementState_(userId, chatId);

    telegramSendMessage_(chatId, 'Текущее действие отменено.', buildTelegramMainKeyboard_());
    return;
  }

  const mainButtons = [
    '📅 Сегодня', '⏮ Вчера', '➕ Записать', '👥 Клиенты',
    '📦 Остатки', '💳 Долги', '📊 Отчёт'
  ];
  if ((pendingPayment || pendingMove || pendingSchedule || pendingManagement) &&
      mainButtons.indexOf(text) !== -1) {
    telegramSendMessage_(chatId,
      'Сначала заверши текущее действие или нажми «❌ Отменить действие».',
      {keyboard: [[{text: '❌ Отменить действие'}]], resize_keyboard: true}
    );
    return;
  }

  if (pendingManagement && command.charAt(0) !== '/') {
    handleTelegramManagementInput_(pendingManagement, userId, chatId, text);
    return;
  }

  if (pendingSchedule && command.charAt(0) !== '/') {
    handleTelegramScheduleInput_(pendingSchedule, userId, chatId, text);
    return;
  }

  if (pendingPayment && command.charAt(0) !== '/') {
    handleTelegramPaymentAmount_(pendingPayment, userId, chatId, text);
    return;
  }

  if (pendingMove && command.charAt(0) !== '/') {
    handleTelegramMoveInput_(pendingMove, userId, chatId, text);
    return;
  }

  if (command === '/today' || command === '/day' || text === '📅 Сегодня') {
    syncCalendarToQueue();
    sendTelegramQueueDashboard_(chatId, new Date());
    return;
  }

  if (command === '/yesterday' || text === '⏮ Вчера') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    sendTelegramQueueDashboard_(chatId, date);
    return;
  }

  if (command === '/schedule' || text === '➕ Записать') {
    sendTelegramScheduleClientList_(chatId, 0, null);
    return;
  }

  if (command === '/balances' || text === '📦 Остатки') {
    telegramSendMessage_(chatId, buildTelegramBalancesText_(), null);
    return;
  }

  if (command === '/clients' || text === '👥 Клиенты') {
    sendTelegramClientList_(chatId, 0, null);
    return;
  }

  if (command === '/client') {
    const query = text.substring(text.indexOf(' ') + 1).trim();
    if (!query || query === text) {
      sendTelegramClientList_(chatId, 0, null);
    } else {
      sendTelegramClientSearch_(chatId, query);
    }
    return;
  }

  if (command === '/debt' || text === '💳 Долги') {
    telegramSendMessage_(chatId, buildTelegramDebtText_(), null);
    return;
  }

  if (command === '/report' || text === '📊 Отчёт') {
    telegramSendMessage_(chatId, buildTelegramReportText_(), null);
    return;
  }

  if (command === '/chatid') {
    telegramSendMessage_(chatId,
      'User ID: <code>' + escapeTelegramHtml_(userId) + '</code>\n' +
      'Chat ID: <code>' + escapeTelegramHtml_(chatId) + '</code>',
      null
    );
    return;
  }

  telegramSendMessage_(chatId, telegramHelpText_(), buildTelegramMainKeyboard_());
}

function handleTelegramCallbackV8_(query) {
  const message = query.message || {};
  const chatId = message.chat && message.chat.id;
  const userId = query.from && query.from.id;

  if (!isTelegramAdmin_(userId, chatId)) {
    telegramAnswerCallback_(query.id, 'Нет доступа', true);
    return;
  }

  const data = String(query.data || '');

  if (isTelegramManagementCallback_(data)) {
    handleTelegramManagementCallback_(query, data, userId, chatId, message.message_id);
    return;
  }

  if (data.indexOf('slp:') === 0) {
    telegramAnswerCallback_(query.id, 'Открываю список', false);
    sendTelegramScheduleClientList_(chatId, Number(data.substring(4)) || 0, message.message_id);
    return;
  }

  if (data.indexOf('sc:') === 0) {
    clearTelegramPaymentState_(userId, chatId);
    clearTelegramMoveState_(userId, chatId);
    clearTelegramManagementState_(userId, chatId);
    startTelegramSchedule_(userId, chatId, data.substring(3), message.message_id);
    telegramAnswerCallback_(query.id, 'Выбери дату', false);
    return;
  }

  if (data.indexOf('sdt:') === 0) {
    telegramAnswerCallback_(query.id, 'Дата выбрана', false);
    setTelegramScheduleDate_(userId, chatId, data.substring(4), message.message_id);
    return;
  }

  if (data.indexOf('sdu:') === 0) {
    telegramAnswerCallback_(query.id, 'Длительность выбрана', false);
    setTelegramScheduleDuration_(userId, chatId, Number(data.substring(4)), message.message_id);
    return;
  }

  if (data === 'scc:no') {
    clearTelegramScheduleState_(userId, chatId);
    telegramAnswerCallback_(query.id, 'Запись отменена', false);
    telegramEditMessage_(chatId, message.message_id, 'Создание тренировки отменено.', null);
    return;
  }

  if (data === 'scc:yes' || data === 'scc:force') {
    telegramAnswerCallback_(query.id, 'Создаю событие…', false);
    confirmTelegramSchedule_(userId, chatId, message.message_id, data === 'scc:force');
    return;
  }

  if (data.indexOf('clp:') === 0) {
    telegramAnswerCallback_(query.id, 'Открываю список', false);
    sendTelegramClientList_(chatId, Number(data.substring(4)) || 0, message.message_id);
    return;
  }

  if (data.indexOf('cl:') === 0) {
    telegramAnswerCallback_(query.id, 'Открываю карточку', false);
    sendTelegramClientCard_(chatId, data.substring(3), message.message_id);
    return;
  }

  if (data.indexOf('pm:') === 0) {
    const parts = data.split(':');
    clearTelegramScheduleState_(userId, chatId);
    clearTelegramManagementState_(userId, chatId);
    beginTelegramPayment_(userId, chatId, parts[1], parts[2]);
    telegramAnswerCallback_(query.id, 'Жду сумму', false);
    return;
  }

  if (data === 'pc:no') {
    clearTelegramPaymentState_(userId, chatId);
    telegramAnswerCallback_(query.id, 'Оплата отменена', false);
    telegramEditMessage_(chatId, message.message_id, 'Внесение оплаты отменено.', null);
    return;
  }

  if (data === 'pc:yes') {
    telegramAnswerCallback_(query.id, 'Записываю оплату…', false);
    confirmTelegramPayment_(userId, chatId, message.message_id);
    return;
  }

  if (data.indexOf('qd:') === 0) {
    const parts = data.split(':');
    const result = setTelegramQueueDecision_(parts[1], parts[2]);

    if (parts[2] === 'move') {
      clearTelegramPaymentState_(userId, chatId);
      clearTelegramScheduleState_(userId, chatId);
      clearTelegramManagementState_(userId, chatId);
      startTelegramMove_(userId, chatId, message.message_id, result);
      telegramAnswerCallback_(query.id, 'Жду новую дату и время', false);
      refreshTelegramQueueMessage_(chatId, message.message_id, result.date);
      return;
    }

    clearTelegramMoveState_(userId, chatId);
    telegramAnswerCallback_(query.id, result.notice, false);
    refreshTelegramQueueMessage_(chatId, message.message_id, result.date);
    return;
  }

  if (data.indexOf('qp:') === 0) {
    const dateKey = data.substring(3);
    telegramAnswerCallback_(query.id, 'Обрабатываю день…', false);

    try {
      syncCalendarToQueue();
      const date = parseTelegramDateKey_(dateKey);
      activateStartedPlannedBlocksForDate_(date);
      const result = processQueueDate_(date, 'Telegram', false);
      const calendarResult = applyTelegramCalendarCancellationsForDate_(date);
      const text = buildTelegramDayConfirmationText_(date, result, calendarResult) +
        buildTelegramWarningsText_();
      telegramEditMessage_(chatId, message.message_id, text, null);
    } catch (error) {
      telegramSendMessage_(chatId,
        '<b>Не удалось подтвердить день</b>\n' +
        escapeTelegramHtml_(error.message || String(error)),
        null
      );
    }
    return;
  }

  if (data.indexOf('qr:') === 0) {
    const date = parseTelegramDateKey_(data.substring(3));
    telegramAnswerCallback_(query.id, 'Обновляю…', false);
    syncCalendarToQueue();
    refreshTelegramQueueMessage_(chatId, message.message_id, date);
    return;
  }

  telegramAnswerCallback_(query.id, 'Команда устарела', false);
}

function isTelegramManagementCallback_(data) {
  return /^(nc|nt|nb|mg|mgc|ma|mn|mp|mpc|mr|mrc|mcl|mclc|mc|ncount|nprice|ndate)(:|$)/
    .test(String(data || ''));
}

function handleTelegramManagementCallback_(query, data, userId, chatId, messageId) {
  try {
    if (data === 'nc:start') {
      startTelegramNewClient_(userId, chatId);
      telegramAnswerCallback_(query.id, 'Жду имя', false);
      return;
    }

    if (data.indexOf('nt:') === 0) {
      chooseTelegramNewClientType_(userId, chatId, data.substring(3), messageId);
      telegramAnswerCallback_(query.id, 'Формат выбран', false);
      return;
    }

    if (data.indexOf('nb:') === 0) {
      telegramAnswerCallback_(query.id, 'Настраиваем блок', false);
      startTelegramNewBlock_(userId, chatId, data.substring(3), messageId);
      return;
    }

    if (data.indexOf('mg:') === 0) {
      telegramAnswerCallback_(query.id, 'Проверь действие', false);
      showTelegramGiftConfirmation_(chatId, data.substring(3), messageId);
      return;
    }

    if (data.indexOf('mgc:') === 0) {
      confirmTelegramGift_(chatId, data.substring(4), messageId);
      telegramAnswerCallback_(query.id, 'Добавляю тренировку…', false);
      return;
    }

    if (data.indexOf('ma:') === 0) {
      telegramAnswerCallback_(query.id, 'Жду остаток', false);
      startTelegramBalanceAdjustment_(userId, chatId, data.substring(3));
      return;
    }

    if (data.indexOf('mn:') === 0) {
      telegramAnswerCallback_(query.id, 'Жду заметку', false);
      startTelegramClientNote_(userId, chatId, data.substring(3));
      return;
    }

    if (data.indexOf('mp:') === 0) {
      telegramAnswerCallback_(query.id, 'Проверь действие', false);
      showTelegramBlockStatusConfirmation_(chatId, data.substring(3), 'pause', messageId);
      return;
    }

    if (data.indexOf('mr:') === 0) {
      telegramAnswerCallback_(query.id, 'Проверь действие', false);
      showTelegramBlockStatusConfirmation_(chatId, data.substring(3), 'resume', messageId);
      return;
    }

    if (data.indexOf('mcl:') === 0 && data.indexOf('mclc:') !== 0) {
      telegramAnswerCallback_(query.id, 'Проверь действие', false);
      showTelegramBlockStatusConfirmation_(chatId, data.substring(4), 'close', messageId);
      return;
    }

    if (data.indexOf('mpc:') === 0) {
      confirmTelegramBlockStatus_(chatId, data.substring(4), 'pause', messageId);
      telegramAnswerCallback_(query.id, 'Приостанавливаю…', false);
      return;
    }

    if (data.indexOf('mrc:') === 0) {
      confirmTelegramBlockStatus_(chatId, data.substring(4), 'resume', messageId);
      telegramAnswerCallback_(query.id, 'Возобновляю…', false);
      return;
    }

    if (data.indexOf('mclc:') === 0) {
      confirmTelegramBlockStatus_(chatId, data.substring(5), 'close', messageId);
      telegramAnswerCallback_(query.id, 'Закрываю блок…', false);
      return;
    }

    if (data.indexOf('mc:') === 0) {
      const decision = data.substring(3);
      if (decision === 'no') {
        clearTelegramManagementState_(userId, chatId);
        telegramAnswerCallback_(query.id, 'Действие отменено', false);
        telegramEditMessage_(chatId, messageId, 'Действие отменено.', null);
      } else if (decision === 'yes') {
        telegramAnswerCallback_(query.id, 'Сохраняю…', false);
        confirmTelegramManagementState_(userId, chatId, messageId);
      }
      return;
    }

    if (data.indexOf('ncount:') === 0) {
      setTelegramManagementBlockCount_(userId, chatId, data.substring(7), messageId);
      telegramAnswerCallback_(query.id, 'Количество выбрано', false);
      return;
    }

    if (data.indexOf('nprice:') === 0) {
      setTelegramManagementBlockPrice_(userId, chatId, data.substring(7), messageId);
      telegramAnswerCallback_(query.id, 'Стоимость выбрана', false);
      return;
    }

    if (data.indexOf('ndate:') === 0) {
      setTelegramManagementBlockDate_(userId, chatId, data.substring(6), messageId);
      telegramAnswerCallback_(query.id, 'Дата выбрана', false);
      return;
    }
  } catch (error) {
    telegramAnswerCallback_(query.id, 'Не удалось выполнить', true);
    telegramSendMessage_(chatId,
      '<b>Действие не выполнено</b>\n' +
      escapeTelegramHtml_(error.message || String(error)),
      null
    );
  }
}

function startTelegramNewClient_(userId, chatId) {
  clearTelegramPaymentState_(userId, chatId);
  clearTelegramMoveState_(userId, chatId);
  clearTelegramScheduleState_(userId, chatId);
  putTelegramManagementState_(userId, chatId, {
    phase: 'new_client_name',
    action: 'new_client'
  });

  telegramSendMessage_(chatId,
    '<b>Новый клиент</b>\nПришли имя клиента одним сообщением.\n\n' +
    'Например: <code>Иван Петров</code>\n/cancel — отменить.',
    buildTelegramCancelKeyboard_()
  );
}

function chooseTelegramNewClientType_(userId, chatId, type, messageId) {
  const state = getRequiredTelegramManagementState_(userId, chatId);
  if (state.phase !== 'new_client_type') throw new Error('Начни добавление клиента заново.');

  if (type === 'single') {
    state.clientType = 'single';
    state.phase = 'new_client_single_price';
    putTelegramManagementState_(userId, chatId, state);
    telegramEditMessage_(chatId, messageId,
      '<b>' + escapeTelegramHtml_(state.clientName) + '</b>\n' +
      'Пришли стоимость разовой тренировки, например: <code>3500</code>.',
      null
    );
    return;
  }

  if (type === 'block') {
    state.clientType = 'block';
    state.phase = 'block_count';
    putTelegramManagementState_(userId, chatId, state);
    sendTelegramBlockCountPrompt_(chatId, messageId, state.clientName);
    return;
  }

  throw new Error('Неизвестный формат клиента.');
}

function startTelegramNewBlock_(userId, chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  if (card.blockId) {
    throw new Error('У клиента уже есть активный блок ' + card.blockId + '. Сначала закрой его.');
  }

  clearTelegramPaymentState_(userId, chatId);
  clearTelegramMoveState_(userId, chatId);
  clearTelegramScheduleState_(userId, chatId);
  putTelegramManagementState_(userId, chatId, {
    phase: 'block_count',
    action: 'new_block',
    clientId: card.id,
    clientName: card.name
  });
  sendTelegramBlockCountPrompt_(chatId, messageId, card.name);
}

function sendTelegramBlockCountPrompt_(chatId, messageId, clientName) {
  const text = '<b>Новый блок: ' + escapeTelegramHtml_(clientName) + '</b>\n' +
    'Сколько тренировок будет в блоке?';
  const markup = {inline_keyboard: [
    [
      {text: '5 тренировок', callback_data: 'ncount:5'},
      {text: '10 тренировок', callback_data: 'ncount:10'}
    ],
    [{text: 'Другое количество', callback_data: 'ncount:x'}],
    [{text: '❌ Отмена', callback_data: 'mc:no'}]
  ]};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function setTelegramManagementBlockCount_(userId, chatId, value, messageId) {
  const state = getRequiredTelegramManagementState_(userId, chatId);
  if (state.phase !== 'block_count') throw new Error('Начни создание блока заново.');

  if (value === 'x') {
    state.phase = 'block_count_custom';
    putTelegramManagementState_(userId, chatId, state);
    telegramEditMessage_(chatId, messageId,
      'Пришли количество тренировок числом от 1 до 100.',
      null
    );
    return;
  }

  state.blockCount = validateTelegramPositiveInteger_(value, 1, 100, 'Количество тренировок');
  continueTelegramBlockPrice_(userId, chatId, state, messageId);
}

function continueTelegramBlockPrice_(userId, chatId, state, messageId) {
  state.phase = 'block_price';
  putTelegramManagementState_(userId, chatId, state);

  const suggested = state.blockCount === 5 ? 16000 : state.blockCount === 10 ? 30000 : 0;
  if (!suggested) {
    sendOrEditTelegramMessage_(chatId, messageId,
      'Пришли полную стоимость блока, например: <code>27000</code>.',
      null
    );
    return;
  }

  sendOrEditTelegramMessage_(chatId, messageId,
    'Стоимость блока из ' + state.blockCount + ' тренировок:',
    {inline_keyboard: [
      [{text: formatTelegramMoney_(suggested), callback_data: 'nprice:' + suggested}],
      [{text: 'Другая стоимость', callback_data: 'nprice:x'}],
      [{text: '❌ Отмена', callback_data: 'mc:no'}]
    ]}
  );
}

function setTelegramManagementBlockPrice_(userId, chatId, value, messageId) {
  const state = getRequiredTelegramManagementState_(userId, chatId);
  if (state.phase !== 'block_price') throw new Error('Начни создание блока заново.');

  if (value === 'x') {
    state.phase = 'block_price_custom';
    putTelegramManagementState_(userId, chatId, state);
    telegramEditMessage_(chatId, messageId,
      'Пришли полную стоимость блока числом.',
      null
    );
    return;
  }

  state.blockPrice = validateTelegramMoney_(value);
  continueTelegramBlockDate_(userId, chatId, state, messageId);
}

function continueTelegramBlockDate_(userId, chatId, state, messageId) {
  state.phase = 'block_date';
  putTelegramManagementState_(userId, chatId, state);
  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const now = new Date();
  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);

  sendOrEditTelegramMessage_(chatId, messageId,
    'Когда начинается блок?',
    {inline_keyboard: [
      [
        {text: 'Сегодня ' + Utilities.formatDate(now, timeZone, 'dd.MM'), callback_data: 'ndate:0'},
        {text: 'Завтра ' + Utilities.formatDate(tomorrow, timeZone, 'dd.MM'), callback_data: 'ndate:1'}
      ],
      [{text: 'Другая дата', callback_data: 'ndate:x'}],
      [{text: '❌ Отмена', callback_data: 'mc:no'}]
    ]}
  );
}

function setTelegramManagementBlockDate_(userId, chatId, value, messageId) {
  const state = getRequiredTelegramManagementState_(userId, chatId);
  if (state.phase !== 'block_date') throw new Error('Начни создание блока заново.');

  if (value === 'x') {
    state.phase = 'block_date_custom';
    putTelegramManagementState_(userId, chatId, state);
    telegramEditMessage_(chatId, messageId,
      'Пришли дату начала в формате <code>25.08</code> или <code>25.08.2026</code>.',
      null
    );
    return;
  }

  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const date = new Date();
  date.setDate(date.getDate() + (Number(value) || 0));
  state.blockDateKey = Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
  showTelegramManagementConfirmation_(userId, chatId, state, messageId);
}

function handleTelegramManagementInput_(state, userId, chatId, text) {
  try {
    if (state.phase === 'new_client_name') {
      const name = validateTelegramClientName_(text);
      assertTelegramClientNameAvailable_(name);
      state.clientName = name;
      state.phase = 'new_client_type';
      putTelegramManagementState_(userId, chatId, state);
      telegramSendMessage_(chatId,
        '<b>' + escapeTelegramHtml_(name) + '</b>\nКак клиент будет заниматься?',
        {inline_keyboard: [
          [{text: '🎟 Разовые', callback_data: 'nt:single'}],
          [{text: '📦 Сразу открыть блок', callback_data: 'nt:block'}],
          [{text: '❌ Отмена', callback_data: 'mc:no'}]
        ]}
      );
      return;
    }

    if (state.phase === 'new_client_single_price') {
      state.singlePrice = validateTelegramMoney_(text);
      showTelegramManagementConfirmation_(userId, chatId, state, null);
      return;
    }

    if (state.phase === 'block_count_custom') {
      state.blockCount = validateTelegramPositiveInteger_(text, 1, 100, 'Количество тренировок');
      continueTelegramBlockPrice_(userId, chatId, state, null);
      return;
    }

    if (state.phase === 'block_price' || state.phase === 'block_price_custom') {
      state.blockPrice = validateTelegramMoney_(text);
      continueTelegramBlockDate_(userId, chatId, state, null);
      return;
    }

    if (state.phase === 'block_date_custom') {
      const ss = SpreadsheetApp.getActive();
      const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
      const date = parseTelegramScheduleDate_(text, timeZone, new Date());
      state.blockDateKey = Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
      showTelegramManagementConfirmation_(userId, chatId, state, null);
      return;
    }

    if (state.phase === 'adjust_remaining') {
      const card = getTelegramClientCard_(state.clientId);
      if (!card.blockId || card.blockId !== state.blockId) {
        throw new Error('Активный блок клиента изменился. Начни заново.');
      }
      state.newRemaining = validateTelegramPositiveInteger_(text, 0, 100, 'Остаток');
      state.oldRemaining = Number(card.remainingNumber) || 0;
      state.completed = Number(card.completedNumber) || 0;
      state.oldTotal = Number(card.blockTotal) || 0;
      state.newTotal = state.completed + state.newRemaining;
      showTelegramManagementConfirmation_(userId, chatId, state, null);
      return;
    }

    if (state.phase === 'client_note') {
      const note = String(text || '').trim();
      if (!note) throw new Error('Заметка не может быть пустой.');
      if (note.length > DMS_TELEGRAM_MANAGEMENT.MAX_NOTE_LENGTH) {
        throw new Error('Заметка длиннее ' + DMS_TELEGRAM_MANAGEMENT.MAX_NOTE_LENGTH + ' символов.');
      }
      state.note = note;
      showTelegramManagementConfirmation_(userId, chatId, state, null);
      return;
    }

    throw new Error('Срок действия шага истёк. Начни заново.');
  } catch (error) {
    telegramSendMessage_(chatId,
      '<b>Не удалось принять данные</b>\n' +
      escapeTelegramHtml_(error.message || String(error)),
      buildTelegramCancelKeyboard_()
    );
  }
}

function showTelegramManagementConfirmation_(userId, chatId, state, messageId) {
  state.phase = 'confirm';
  putTelegramManagementState_(userId, chatId, state);

  let text = '<b>Проверь данные</b>\n';
  if (state.action === 'new_client' && state.clientType === 'single') {
    text += 'Новый клиент: <b>' + escapeTelegramHtml_(state.clientName) + '</b>\n' +
      'Формат: разовые тренировки\n' +
      'Стоимость: <b>' + escapeTelegramHtml_(formatTelegramMoney_(state.singlePrice)) + '</b>\n' +
      'Статус: активен';
  } else if (state.action === 'new_client' || state.action === 'new_block') {
    const date = parseTelegramDateKey_(state.blockDateKey);
    const timeZone = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Europe/Moscow';
    text += 'Клиент: <b>' + escapeTelegramHtml_(state.clientName) + '</b>\n' +
      (state.action === 'new_client' ? 'Действие: новый клиент и новый блок\n' : 'Действие: новый блок\n') +
      'Тренировок: <b>' + state.blockCount + '</b>\n' +
      'Стоимость: <b>' + escapeTelegramHtml_(formatTelegramMoney_(state.blockPrice)) + '</b>\n' +
      'Начало: <b>' + Utilities.formatDate(date, timeZone, 'dd.MM.yyyy') + '</b>\n' +
      'Оплата: не внесена';
  } else if (state.action === 'adjust_remaining') {
    text += 'Клиент: <b>' + escapeTelegramHtml_(state.clientName) + '</b>\n' +
      'Блок: ' + escapeTelegramHtml_(state.blockId) + '\n' +
      'Остаток: <s>' + state.oldRemaining + '</s> → <b>' + state.newRemaining + '</b>\n' +
      'Размер блока станет: ' + state.newTotal;
  } else if (state.action === 'client_note') {
    text += 'Клиент: <b>' + escapeTelegramHtml_(state.clientName) + '</b>\n' +
      'Добавить заметку:\n<i>' + escapeTelegramHtml_(state.note) + '</i>';
  } else {
    throw new Error('Неизвестное действие.');
  }

  const markup = {inline_keyboard: [[
    {text: '✅ Сохранить', callback_data: 'mc:yes'},
    {text: '❌ Отмена', callback_data: 'mc:no'}
  ]]};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function confirmTelegramManagementState_(userId, chatId, messageId) {
  const state = getRequiredTelegramManagementState_(userId, chatId);
  if (state.phase !== 'confirm') {
    throw new Error('Срок подтверждения истёк. Начни действие заново.');
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  }

  try {
    let result;
    if (state.action === 'new_client') {
      result = createTelegramClient_(state);
    } else if (state.action === 'new_block') {
      result = createTelegramBlockForExistingClient_(state);
    } else if (state.action === 'adjust_remaining') {
      result = applyTelegramBalanceAdjustment_(state);
    } else if (state.action === 'client_note') {
      result = applyTelegramClientNote_(state);
    } else {
      throw new Error('Неизвестное действие.');
    }

    clearTelegramManagementState_(userId, chatId);
    SpreadsheetApp.flush();
    telegramEditMessage_(chatId, messageId,
      '<b>Готово</b>\n' + escapeTelegramHtml_(result.notice),
      {inline_keyboard: [[
        {text: '👤 Карточка клиента', callback_data: 'cl:' + result.clientId},
        {text: '🔙 Клиенты', callback_data: 'clp:0'}
      ]]}
    );
  } catch (error) {
    telegramSendMessage_(chatId,
      '<b>Изменения не сохранены</b>\n' +
      escapeTelegramHtml_(error.message || String(error)),
      null
    );
  } finally {
    lock.releaseLock();
  }
}

function startTelegramBalanceAdjustment_(userId, chatId, clientId) {
  const card = getTelegramClientCard_(clientId);
  if (!card.blockId) throw new Error('У клиента нет активного блока.');
  putTelegramManagementState_(userId, chatId, {
    phase: 'adjust_remaining',
    action: 'adjust_remaining',
    clientId: card.id,
    clientName: card.name,
    blockId: card.blockId
  });
  telegramSendMessage_(chatId,
    '<b>Корректировка остатка: ' + escapeTelegramHtml_(card.name) + '</b>\n' +
    'Сейчас осталось: <b>' + escapeTelegramHtml_(card.remaining || '0') + '</b>.\n' +
    'Пришли новый остаток числом.\n/cancel — отменить.',
    buildTelegramCancelKeyboard_()
  );
}

function startTelegramClientNote_(userId, chatId, clientId) {
  const card = getTelegramClientCard_(clientId);
  putTelegramManagementState_(userId, chatId, {
    phase: 'client_note',
    action: 'client_note',
    clientId: card.id,
    clientName: card.name
  });
  telegramSendMessage_(chatId,
    '<b>Новая заметка: ' + escapeTelegramHtml_(card.name) + '</b>\n' +
    'Пришли текст заметки. Она добавится к текущим условиям и не сотрёт их.\n' +
    '/cancel — отменить.',
    buildTelegramCancelKeyboard_()
  );
}

function createTelegramClient_(state) {
  assertTelegramClientNameAvailable_(state.clientName);
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.CLIENTS);
  const clientId = makeNextTelegramEntityId_(
    clients,
    DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW,
    'CL'
  );
  const clientRow = findTelegramEmptyEntityRow_(clients, DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW);
  let blockId = '';
  let format = 'Разовая';
  let conditions = 'Разовая тренировка — ' + formatTelegramMoney_(state.singlePrice || 0);

  if (state.clientType === 'block') {
    blockId = createTelegramBlockRow_(state, clientId);
    format = 'Блок ' + state.blockCount;
    conditions = 'Клиент создан через Telegram';
  }

  prepareTelegramEntityRow_(
    clients,
    clientRow,
    DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW,
    DMS_TELEGRAM_MANAGEMENT.CLIENT_COLUMNS
  );
  clients.getRange(clientRow, 1, 1, 5).setValues([[
    clientId,
    state.clientName,
    'Активен',
    blockId,
    format
  ]]);
  clients.getRange(clientRow, 11).setValue(conditions);
  clients.getRange(clientRow, 12).insertCheckboxes().setValue(false);
  clients.getRange(clientRow, 13, 1, 2).setValues([[
    makeTelegramClientCalendarTitle_(state.clientName),
    ''
  ]]);

  return {
    clientId: clientId,
    notice: state.clientType === 'block'
      ? state.clientName + ' добавлен. Создан блок ' + blockId + '; оплата пока не внесена.'
      : state.clientName + ' добавлен как разовый клиент.'
  };
}

function createTelegramBlockForExistingClient_(state) {
  const card = getTelegramClientCard_(state.clientId);
  if (card.blockId) {
    throw new Error('У клиента уже появился активный блок ' + card.blockId + '.');
  }

  const blockId = createTelegramBlockRow_(state, card.id);
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.CLIENTS);
  const clientRow = findRowByValue_(
    clients,
    1,
    card.id,
    DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW
  );
  if (!clientRow) throw new Error('Клиент не найден.');

  clients.getRange(clientRow, 4).setValue(blockId);
  clients.getRange(clientRow, 5).setValue('Блок ' + state.blockCount);
  return {
    clientId: card.id,
    notice: 'Создан блок ' + blockId + ' на ' + state.blockCount +
      ' тренировок. К оплате ' + formatTelegramMoney_(state.blockPrice) + '.'
  };
}

function createTelegramBlockRowLegacyV8_(state, clientId) {
  const ss = SpreadsheetApp.getActive();
  const blocks = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.BLOCKS);
  const blockId = makeNextTelegramEntityId_(
    blocks,
    DMS_TELEGRAM_MANAGEMENT.BLOCK_FIRST_ROW,
    'BL'
  );
  const blockRow = findTelegramEmptyEntityRow_(blocks, DMS_TELEGRAM_MANAGEMENT.BLOCK_FIRST_ROW);
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const startDate = Utilities.parseDate(
    state.blockDateKey + ' 12:00',
    timeZone,
    'yyyy-MM-dd HH:mm'
  );
  const price = Number(state.blockPrice) || 0;
  const count = Number(state.blockCount) || 0;
  const todayKey = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  const status = state.blockDateKey > todayKey ? 'Планируется' : 'Активен';

  prepareTelegramEntityRow_(
    blocks,
    blockRow,
    DMS_TELEGRAM_MANAGEMENT.BLOCK_FIRST_ROW,
    DMS_TELEGRAM_MANAGEMENT.BLOCK_COLUMNS
  );
  blocks.getRange(blockRow, 1, 1, 8).setValues([[
    blockId,
    clientId,
    'Блок ' + count,
    status,
    startDate,
    '',
    '',
    count
  ]]);
  setTelegramBlockStatus_(blocks, blockRow, status);
  blocks.getRange(blockRow, 11).setValue(price);
  blocks.getRange(blockRow, 13).clearContent();
  blocks.getRange(blockRow, 16).setValue(
    'Создан через Telegram ' + Utilities.formatDate(new Date(), timeZone, 'dd.MM.yyyy')
  );
  blocks.getRange(blockRow, 17).insertCheckboxes().setValue(false);
  return blockId;
}

function applyTelegramBalanceAdjustment_(state) {
  const block = getTelegramBlockRecord_(state.blockId);
  if (!block || block.clientId !== state.clientId) {
    throw new Error('Активный блок изменился. Корректировка не выполнена.');
  }
  if (Number(block.total) !== Number(state.oldTotal)) {
    throw new Error('Размер блока уже изменился. Открой карточку и повтори.');
  }

  const ss = SpreadsheetApp.getActive();
  const blocks = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.BLOCKS);
  blocks.getRange(block.row, 8).setValue(Number(state.newTotal));
  blocks.getRange(block.row, 16).setValue(appendTelegramAuditNote_(
    block.conditions,
    'Остаток скорректирован: ' + state.oldRemaining + ' → ' + state.newRemaining
  ));
  return {
    clientId: state.clientId,
    notice: 'Остаток изменён: ' + state.oldRemaining + ' → ' + state.newRemaining + '.'
  };
}

function applyTelegramClientNote_(state) {
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.CLIENTS);
  const row = findRowByValue_(
    clients,
    1,
    state.clientId,
    DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW
  );
  if (!row) throw new Error('Клиент не найден.');
  const current = clients.getRange(row, 11).getDisplayValue();
  clients.getRange(row, 11).setValue(appendTelegramAuditNote_(current, state.note));
  return {clientId: state.clientId, notice: 'Заметка добавлена в карточку клиента.'};
}

function showTelegramGiftConfirmation_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  if (!card.blockId) throw new Error('У клиента нет активного блока.');
  telegramEditMessage_(chatId, messageId,
    '<b>Подарить тренировку?</b>\n' +
    'Клиент: ' + escapeTelegramHtml_(card.name) + '\n' +
    'Блок: ' + escapeTelegramHtml_(card.blockId) + '\n' +
    'Остаток станет: <b>' + (Number(card.remainingNumber) + 1) + '</b>',
    {inline_keyboard: [[
      {
        text: '🎁 Добавить',
        callback_data: 'mgc:' + card.id + ':' + card.blockId + ':' + card.blockTotal
      },
      {text: '❌ Отмена', callback_data: 'cl:' + card.id}
    ]]}
  );
}

function confirmTelegramGift_(chatId, payload, messageId) {
  const parts = String(payload || '').split(':');
  const clientId = parts[0];
  const blockId = parts[1];
  const expectedTotal = Number(parts[2]);
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется.');

  try {
    const block = getTelegramBlockRecord_(blockId);
    if (!block || block.clientId !== clientId) throw new Error('Блок изменился.');
    if (Number(block.total) !== expectedTotal) {
      throw new Error('Размер блока уже изменился. Обнови карточку и повтори.');
    }
    const ss = SpreadsheetApp.getActive();
    const blocks = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.BLOCKS);
    blocks.getRange(block.row, 8).setValue(expectedTotal + 1);
    blocks.getRange(block.row, 16).setValue(appendTelegramAuditNote_(
      block.conditions,
      'Подарена 1 тренировка'
    ));
    SpreadsheetApp.flush();
    telegramEditMessage_(chatId, messageId,
      '<b>Подарочная тренировка добавлена</b>\n' +
      escapeTelegramHtml_(blockId) + ': размер блока ' + expectedTotal + ' → ' + (expectedTotal + 1) + '.',
      {inline_keyboard: [[{text: '👤 Карточка клиента', callback_data: 'cl:' + clientId}]]}
    );
  } finally {
    lock.releaseLock();
  }
}

function showTelegramBlockStatusConfirmation_(chatId, clientId, action, messageId) {
  const card = getTelegramClientCard_(clientId);
  if (!card.blockId) throw new Error('У клиента нет активного блока.');
  const config = {
    pause: {
      title: 'Приостановить блок?',
      warning: 'До возобновления тренировки по блоку не будут списываться.',
      button: '⏸ Приостановить',
      callback: 'mpc:'
    },
    resume: {
      title: 'Возобновить блок?',
      warning: 'Блок снова станет доступен для учёта тренировок.',
      button: '▶️ Возобновить',
      callback: 'mrc:'
    },
    close: {
      title: 'Закрыть блок?',
      warning: 'Остаток ' + card.remaining + ' будет зафиксирован. История и будущие записи в календаре сохранятся.',
      button: '✅ Закрыть блок',
      callback: 'mclc:'
    }
  }[action];
  if (!config) throw new Error('Неизвестное действие.');

  telegramEditMessage_(chatId, messageId,
    '<b>' + config.title + '</b>\n' +
    'Клиент: ' + escapeTelegramHtml_(card.name) + '\n' +
    'Блок: ' + escapeTelegramHtml_(card.blockId) + '\n\n' +
    escapeTelegramHtml_(config.warning),
    {inline_keyboard: [[
      {text: config.button, callback_data: config.callback + card.id + ':' + card.blockId},
      {text: '❌ Отмена', callback_data: 'cl:' + card.id}
    ]]}
  );
}

function confirmTelegramBlockStatus_(chatId, payload, action, messageId) {
  const parts = String(payload || '').split(':');
  const clientId = parts[0];
  const blockId = parts[1];
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется.');

  try {
    const card = getTelegramClientCard_(clientId);
    if (card.blockId !== blockId) throw new Error('Активный блок клиента изменился.');
    const block = getTelegramBlockRecord_(blockId);
    if (!block) throw new Error('Блок не найден.');
    const ss = SpreadsheetApp.getActive();
    const blocks = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.BLOCKS);
    const clients = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.CLIENTS);
    const clientRow = findRowByValue_(clients, 1, clientId, DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW);
    const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
    let notice;

    if (action === 'pause') {
      if (block.status !== 'Активен') throw new Error('Блок уже не активен.');
      setTelegramBlockStatus_(blocks, block.row, 'Приостановлен');
      blocks.getRange(block.row, 16).setValue(appendTelegramAuditNote_(block.conditions, 'Блок приостановлен'));
      notice = 'Блок ' + blockId + ' приостановлен.';
    } else if (action === 'resume') {
      if (block.status !== 'Приостановлен') throw new Error('Блок не находится на паузе.');
      setTelegramBlockStatus_(blocks, block.row, 'Активен');
      blocks.getRange(block.row, 16).setValue(appendTelegramAuditNote_(block.conditions, 'Блок возобновлён'));
      notice = 'Блок ' + blockId + ' возобновлён.';
    } else if (action === 'close') {
      setTelegramBlockStatus_(blocks, block.row, 'Закрыт');
      blocks.getRange(block.row, 6).setValue(new Date());
      blocks.getRange(block.row, 7).setValue('Закрыт через Telegram');
      blocks.getRange(block.row, 16).setValue(appendTelegramAuditNote_(block.conditions, 'Блок закрыт'));
      clients.getRange(clientRow, 4).clearContent();
      clients.getRange(clientRow, 5).clearContent();
      notice = 'Блок ' + blockId + ' закрыт ' + Utilities.formatDate(new Date(), timeZone, 'dd.MM.yyyy') + '.';
    } else {
      throw new Error('Неизвестное действие.');
    }

    SpreadsheetApp.flush();
    telegramEditMessage_(chatId, messageId,
      '<b>Готово</b>\n' + escapeTelegramHtml_(notice),
      {inline_keyboard: [[{text: '👤 Карточка клиента', callback_data: 'cl:' + clientId}]]}
    );
  } finally {
    lock.releaseLock();
  }
}

function sendTelegramClientListLegacyV8_(chatId, requestedPage, messageId) {
  const clients = getTelegramActiveClients_();
  const pageCount = Math.max(1, Math.ceil(
    clients.length / DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE
  ));
  const page = Math.max(0, Math.min(Number(requestedPage) || 0, pageCount - 1));
  const start = page * DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE;
  const visible = clients.slice(start, start + DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE);
  const keyboard = visible.map(function(client) {
    const singlePrice = typeof getSingleTrainingPrice_ === 'function'
      ? getSingleTrainingPrice_(client.values[10])
      : 0;
    const rest = client.values[3]
      ? client.values[6] + ' тр.'
      : singlePrice ? 'разовые' : 'без блока';
    return [{
      text: client.name + ' · ' + rest,
      callback_data: 'cl:' + client.id
    }];
  });

  if (pageCount > 1) {
    const navigation = [];
    if (page > 0) navigation.push({text: '◀️', callback_data: 'clp:' + (page - 1)});
    navigation.push({text: (page + 1) + '/' + pageCount, callback_data: 'clp:' + page});
    if (page < pageCount - 1) navigation.push({text: '▶️', callback_data: 'clp:' + (page + 1)});
    keyboard.push(navigation);
  }
  keyboard.push([{text: '➕ Новый клиент', callback_data: 'nc:start'}]);

  const text = '<b>Клиенты</b>\n' +
    (clients.length
      ? 'Выбери клиента для открытия карточки.'
      : 'Активных клиентов пока нет.');
  const markup = {inline_keyboard: keyboard};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function getTelegramClientCard_(clientId) {
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM.CLIENTS);
  const row = findRowByValue_(clients, 1, clientId, DMS_TELEGRAM.CLIENT_FIRST_ROW);
  if (!row) throw new Error('Клиент ' + clientId + ' не найден.');

  const display = clients.getRange(
    row,
    1,
    1,
    DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS
  ).getDisplayValues()[0];
  const raw = clients.getRange(
    row,
    1,
    1,
    DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS
  ).getValues()[0];
  const history = getTelegramBlockTrainingHistory_(display[0], display[3]);
  const block = display[3] ? getTelegramBlockRecord_(display[3]) : null;
  const singlePrice = typeof getSingleTrainingPrice_ === 'function'
    ? getSingleTrainingPrice_(display[10])
    : 0;

  return {
    id: display[0],
    name: display[1],
    status: display[2],
    blockId: display[3],
    format: display[4],
    completed: display[5],
    remaining: display[6],
    blockPrice: display[7],
    paid: display[8],
    debt: display[9],
    conditions: display[10],
    calendarTitle: display[12] || display[1] + ' ПТ',
    calendarAliases: display[13] || '',
    trainingDates: history.dates,
    undatedTrainings: history.undated,
    undatedCharged: history.undatedCharged,
    completedNumber: Number(raw[5]) || 0,
    remainingNumber: Number(raw[6]) || 0,
    singlePrice: singlePrice,
    blockStatus: block ? block.status : '',
    blockTotal: block ? block.total : 0,
    blockStart: block ? block.startDate : null
  };
}

function buildTelegramClientCardTextLegacyV8_(card) {
  const lines = [
    '<b>' + escapeTelegramHtml_(card.name) + '</b>',
    'Статус: ' + escapeTelegramHtml_(card.status)
  ];

  if (card.blockId) {
    lines.push(
      'Блок: <b>' + escapeTelegramHtml_(card.blockId) + '</b> · ' +
        escapeTelegramHtml_(card.format || 'формат не указан'),
      'Статус блока: ' + escapeTelegramHtml_(card.blockStatus || 'не указан'),
      'Тренировки: ' + escapeTelegramHtml_(card.completed || '0') +
        ' учтено · <b>' + escapeTelegramHtml_(card.remaining || '0') + '</b> осталось'
    );
    if (card.trainingDates.length) {
      lines.push('Даты: ' + escapeTelegramHtml_(card.trainingDates.join(', ')));
    }
    if (card.undatedTrainings) lines.push('Без указанной даты: ' + card.undatedTrainings);
    if (card.undatedCharged) lines.push('Без даты (списано): ' + card.undatedCharged);
    lines.push(
      'Стоимость: ' + escapeTelegramHtml_(card.blockPrice || '—'),
      'Оплачено: ' + escapeTelegramHtml_(card.paid || '0 ₽'),
      'Долг: <b>' + escapeTelegramHtml_(card.debt || '0 ₽') + '</b>'
    );
  } else if (card.singlePrice) {
    lines.push(
      'Формат: разовые тренировки',
      'Стоимость: ' + escapeTelegramHtml_(formatTelegramMoney_(card.singlePrice))
    );
  } else {
    lines.push('Активного блока нет.');
  }

  if (card.conditions) lines.push('', 'Условия и заметки: ' + escapeTelegramHtml_(card.conditions));
  return lines.join('\n');
}

function sendTelegramClientCardLegacyV8_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  const keyboard = [[
    {text: '➕ Записать тренировку', callback_data: 'sc:' + card.id}
  ]];

  if (card.blockId) {
    keyboard.push([
      {text: '💳 Перевод', callback_data: 'pm:' + card.id + ':transfer'},
      {text: '💵 Наличные', callback_data: 'pm:' + card.id + ':cash'}
    ]);
    keyboard.push([
      {text: '🎁 Подарить', callback_data: 'mg:' + card.id},
      {text: '✏️ Остаток', callback_data: 'ma:' + card.id}
    ]);
    if (card.blockStatus === 'Приостановлен') {
      keyboard.push([{text: '▶️ Возобновить блок', callback_data: 'mr:' + card.id}]);
    } else if (card.blockStatus === 'Активен') {
      keyboard.push([{text: '⏸ Приостановить блок', callback_data: 'mp:' + card.id}]);
    }
    keyboard.push([{text: '✅ Закрыть блок', callback_data: 'mcl:' + card.id}]);
  } else {
    keyboard.push([{text: '📦 Новый блок', callback_data: 'nb:' + card.id}]);
  }

  keyboard.push([{text: '📝 Добавить заметку', callback_data: 'mn:' + card.id}]);
  keyboard.push([
    {text: '🔄 Обновить', callback_data: 'cl:' + card.id},
    {text: '🔙 Клиенты', callback_data: 'clp:0'}
  ]);

  const text = buildTelegramClientCardText_(card);
  const markup = {inline_keyboard: keyboard};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function getTelegramBlockRecord_(blockId) {
  if (!blockId) return null;
  const ss = SpreadsheetApp.getActive();
  const blocks = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.BLOCKS);
  const row = findRowByValue_(
    blocks,
    1,
    blockId,
    DMS_TELEGRAM_MANAGEMENT.BLOCK_FIRST_ROW
  );
  if (!row) return null;
  const values = blocks.getRange(
    row,
    1,
    1,
    DMS_TELEGRAM_MANAGEMENT.BLOCK_COLUMNS
  ).getValues()[0];
  return {
    row: row,
    id: String(values[0] || ''),
    clientId: String(values[1] || ''),
    format: String(values[2] || ''),
    status: String(values[3] || ''),
    startDate: values[4],
    endDate: values[5],
    total: Number(values[7]) || 0,
    completed: Number(values[8]) || 0,
    remaining: Number(values[9]) || 0,
    price: Number(values[10]) || 0,
    conditions: String(values[15] || '')
  };
}

function prepareTelegramEntityRow_(sheet, targetRow, templateRow, columns) {
  if (targetRow === templateRow) return;
  const template = sheet.getRange(templateRow, 1, 1, columns);
  const target = sheet.getRange(targetRow, 1, 1, columns);
  template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
}

function setTelegramBlockStatusLegacyV8_(sheet, row, status) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Планируется', 'Активен', 'Приостановлен', 'Закрыт'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(row, 4).setDataValidation(rule).setValue(status);
}

function findTelegramEmptyEntityRow_(sheet, firstRow) {
  const lastRow = Math.max(sheet.getLastRow(), firstRow - 1);
  if (lastRow < firstRow) return firstRow;
  const ids = sheet.getRange(firstRow, 1, lastRow - firstRow + 1, 1).getDisplayValues();
  for (let index = 0; index < ids.length; index++) {
    if (!String(ids[index][0] || '').trim()) return firstRow + index;
  }
  return lastRow + 1;
}

function makeNextTelegramEntityId_(sheet, firstRow, prefix) {
  const lastRow = sheet.getLastRow();
  let next = 1;
  if (lastRow >= firstRow) {
    sheet.getRange(firstRow, 1, lastRow - firstRow + 1, 1)
      .getDisplayValues()
      .forEach(function(row) {
        const match = String(row[0] || '').match(new RegExp('^' + prefix + '-(\\d+)$'));
        if (match) next = Math.max(next, Number(match[1]) + 1);
      });
  }
  return prefix + '-' + String(next).padStart(3, '0');
}

function validateTelegramClientName_(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2) throw new Error('Имя слишком короткое.');
  if (name.length > DMS_TELEGRAM_MANAGEMENT.MAX_NAME_LENGTH) {
    throw new Error('Имя длиннее ' + DMS_TELEGRAM_MANAGEMENT.MAX_NAME_LENGTH + ' символов.');
  }
  return name;
}

function assertTelegramClientNameAvailable_(name) {
  const normalized = normalizeTelegramClientSearch_(name);
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.CLIENTS);
  const lastRow = clients.getLastRow();
  if (lastRow < DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW) return;
  const rows = clients.getRange(
    DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW,
    1,
    lastRow - DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW + 1,
    3
  ).getDisplayValues();
  const duplicate = rows.find(function(row) {
    return row[0] && normalizeTelegramClientSearch_(row[1]) === normalized;
  });
  if (duplicate) {
    throw new Error('Клиент «' + duplicate[1] + '» уже существует (' + duplicate[0] + ').');
  }
}

function validateTelegramPositiveInteger_(value, min, max, label) {
  const text = String(value || '').trim();
  if (!/^\d+$/.test(text)) throw new Error(label + ': пришли целое число.');
  const number = Number(text);
  if (number < min || number > max) {
    throw new Error(label + ': допустимо от ' + min + ' до ' + max + '.');
  }
  return number;
}

function validateTelegramMoney_(value) {
  const amount = parseTelegramMoney_(value);
  if (!amount || amount <= 0 || amount > 1000000) {
    throw new Error('Сумма должна быть от 1 до 1 000 000 ₽.');
  }
  return amount;
}

function makeTelegramClientCalendarTitle_(name) {
  return String(name || '').trim() + ' ПТ';
}

function appendTelegramAuditNote_(current, note) {
  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const prefix = Utilities.formatDate(new Date(), timeZone, 'dd.MM.yyyy');
  const existing = String(current || '').trim();
  const addition = prefix + ' · ' + String(note || '').trim();
  return existing ? existing + '\n' + addition : addition;
}

function buildTelegramCancelKeyboard_() {
  return {
    force_reply: true,
    selective: true,
    input_field_placeholder: 'Введи данные или /cancel'
  };
}

function sendOrEditTelegramMessage_(chatId, messageId, text, markup) {
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function makeTelegramManagementCacheKey_(userId, chatId) {
  return DMS_TELEGRAM_MANAGEMENT.CACHE_PREFIX + String(userId) + '_' + String(chatId);
}

function putTelegramManagementState_(userId, chatId, state) {
  CacheService.getScriptCache().put(
    makeTelegramManagementCacheKey_(userId, chatId),
    JSON.stringify(state),
    DMS_TELEGRAM_MANAGEMENT.CACHE_TTL_SECONDS
  );
}

function getTelegramManagementState_(userId, chatId) {
  const raw = CacheService.getScriptCache().get(makeTelegramManagementCacheKey_(userId, chatId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (ignore) {
    clearTelegramManagementState_(userId, chatId);
    return null;
  }
}

function getRequiredTelegramManagementState_(userId, chatId) {
  const state = getTelegramManagementState_(userId, chatId);
  if (!state) throw new Error('Срок действия истёк. Начни заново.');
  return state;
}

function clearTelegramManagementState_(userId, chatId) {
  CacheService.getScriptCache().remove(makeTelegramManagementCacheKey_(userId, chatId));
}

function telegramHelpTextLegacyV8_() {
  return [
    '<b>Основные действия доступны кнопками внизу.</b>',
    '',
    '<b>Команды на случай ручного ввода</b>',
    '/menu — показать кнопки',
    '/schedule — записать тренировку',
    '/today — подтвердить сегодняшний день',
    '/yesterday — проверить вчерашний день',
    '/clients — клиенты, блоки, заметки и оплаты',
    '/client имя — найти клиента',
    '/balances — остатки тренировок',
    '/debt — долги клиентов',
    '/report — отчёт за выбранный месяц',
    '/cancel — отменить текущее действие'
  ].join('\n');
}


// DMS Telegram attention center extension v9.
const DMS_TELEGRAM_ATTENTION = {
  QUEUE: 'Очередь подтверждения',
  CLIENTS: 'Клиенты',
  QUEUE_FIRST_ROW: 4,
  QUEUE_COLUMNS: 17,
  CLIENT_FIRST_ROW: 5,
  CLIENT_COLUMNS: 14,
  LOW_BALANCE_LIMIT: 2,
  MAX_CLIENT_BUTTONS: 12
};

function handleTelegramMessageV9_(message) {
  const chatId = message.chat && message.chat.id;
  const userId = message.from && message.from.id;
  if (!isTelegramAdmin_(userId, chatId)) return;

  const text = String(message.text || '').trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const pendingMove = getTelegramMoveState_(userId, chatId);
  const pendingPayment = getTelegramPaymentState_(userId, chatId);
  const pendingSchedule = getTelegramScheduleState_(userId, chatId);
  const pendingManagement = getTelegramManagementState_(userId, chatId);

  if (command === '/start' || command === '/menu' || text === '🏠 Меню') {
    sendTelegramMainMenu_(chatId);
    return;
  }

  if (command === '/cancel' || text === '❌ Отменить действие') {
    if (pendingMove) {
      cancelTelegramMove_(pendingMove, userId, chatId);
      return;
    }
    if (pendingPayment) clearTelegramPaymentState_(userId, chatId);
    if (pendingSchedule) clearTelegramScheduleState_(userId, chatId);
    if (pendingManagement) clearTelegramManagementState_(userId, chatId);
    telegramSendMessage_(chatId, 'Текущее действие отменено.', buildTelegramMainKeyboard_());
    return;
  }

  const mainButtons = [
    '📅 Сегодня', '⏮ Вчера', '⚠️ Внимание', '➕ Записать',
    '👥 Клиенты', '📦 Остатки', '💳 Долги', '📊 Отчёт'
  ];
  if ((pendingPayment || pendingMove || pendingSchedule || pendingManagement) &&
      mainButtons.indexOf(text) !== -1) {
    telegramSendMessage_(chatId,
      'Сначала заверши текущее действие или нажми «❌ Отменить действие».',
      {keyboard: [[{text: '❌ Отменить действие'}]], resize_keyboard: true}
    );
    return;
  }

  if (pendingManagement && command.charAt(0) !== '/') {
    handleTelegramManagementInput_(pendingManagement, userId, chatId, text);
    return;
  }
  if (pendingSchedule && command.charAt(0) !== '/') {
    handleTelegramScheduleInput_(pendingSchedule, userId, chatId, text);
    return;
  }
  if (pendingPayment && command.charAt(0) !== '/') {
    handleTelegramPaymentAmount_(pendingPayment, userId, chatId, text);
    return;
  }
  if (pendingMove && command.charAt(0) !== '/') {
    handleTelegramMoveInput_(pendingMove, userId, chatId, text);
    return;
  }

  if (command === '/today' || command === '/day' || text === '📅 Сегодня') {
    syncCalendarToQueue();
    sendTelegramQueueDashboard_(chatId, new Date());
    return;
  }
  if (command === '/yesterday' || text === '⏮ Вчера') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    sendTelegramQueueDashboard_(chatId, date);
    return;
  }
  if (command === '/attention' || text === '⚠️ Внимание') {
    syncCalendarToQueue();
    sendTelegramAttentionCenter_(chatId);
    return;
  }
  if (command === '/schedule' || text === '➕ Записать') {
    sendTelegramScheduleClientList_(chatId, 0, null);
    return;
  }
  if (command === '/balances' || text === '📦 Остатки') {
    telegramSendMessage_(chatId, buildTelegramBalancesText_(), null);
    return;
  }
  if (command === '/clients' || text === '👥 Клиенты') {
    sendTelegramClientList_(chatId, 0, null);
    return;
  }
  if (command === '/client') {
    const query = text.substring(text.indexOf(' ') + 1).trim();
    if (!query || query === text) sendTelegramClientList_(chatId, 0, null);
    else sendTelegramClientSearch_(chatId, query);
    return;
  }
  if (command === '/debt' || text === '💳 Долги') {
    telegramSendMessage_(chatId, buildTelegramDebtText_(), null);
    return;
  }
  if (command === '/report' || text === '📊 Отчёт') {
    telegramSendMessage_(chatId, buildTelegramReportText_(), null);
    return;
  }
  if (command === '/chatid') {
    telegramSendMessage_(chatId,
      'User ID: <code>' + escapeTelegramHtml_(userId) + '</code>\n' +
      'Chat ID: <code>' + escapeTelegramHtml_(chatId) + '</code>',
      null
    );
    return;
  }
  telegramSendMessage_(chatId, telegramHelpText_(), buildTelegramMainKeyboard_());
}

function buildTelegramMainKeyboardLegacyV9_() {
  return {
    keyboard: [
      [{text: '📅 Сегодня'}, {text: '⏮ Вчера'}],
      [{text: '⚠️ Внимание'}],
      [{text: '➕ Записать'}],
      [{text: '👥 Клиенты'}, {text: '📦 Остатки'}],
      [{text: '💳 Долги'}, {text: '📊 Отчёт'}],
      [{text: '🏠 Меню'}]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Выбери действие'
  };
}

function sendTelegramAttentionCenter_(chatId) {
  const report = buildTelegramAttentionReport_();
  const keyboard = report.clients.slice(0, DMS_TELEGRAM_ATTENTION.MAX_CLIENT_BUTTONS)
    .map(function(client) {
      return [{text: '👤 ' + client.name, callback_data: 'cl:' + client.id}];
    });
  telegramSendMessage_(chatId, report.text, keyboard.length ? {inline_keyboard: keyboard} : null);
}

function buildTelegramAttentionReport_() {
  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const now = new Date();
  const clientsSheet = getRequiredSheet_(ss, DMS_TELEGRAM_ATTENTION.CLIENTS);
  const queueSheet = getRequiredSheet_(ss, DMS_TELEGRAM_ATTENTION.QUEUE);
  const groups = {
    queue: [],
    debts: [],
    balances: [],
    blocks: []
  };
  const affected = {};

  const clientLastRow = clientsSheet.getLastRow();
  if (clientLastRow >= DMS_TELEGRAM_ATTENTION.CLIENT_FIRST_ROW) {
    clientsSheet.getRange(
      DMS_TELEGRAM_ATTENTION.CLIENT_FIRST_ROW,
      1,
      clientLastRow - DMS_TELEGRAM_ATTENTION.CLIENT_FIRST_ROW + 1,
      DMS_TELEGRAM_ATTENTION.CLIENT_COLUMNS
    ).getDisplayValues().forEach(function(row) {
      if (!row[0] || row[2] !== 'Активен') return;
      const client = {id: row[0], name: row[1]};
      const debt = parseTelegramMoney_(row[9]);
      const singlePrice = typeof getSingleTrainingPrice_ === 'function'
        ? getSingleTrainingPrice_(row[10])
        : 0;

      if (debt > 0) {
        groups.debts.push(client.name + ' — ' + formatTelegramMoney_(debt));
        affected[client.id] = client;
      }
      if (row[3]) {
        const remaining = Number(String(row[6] || '').replace(/[^\d.-]/g, ''));
        if (!isNaN(remaining) && remaining <= DMS_TELEGRAM_ATTENTION.LOW_BALANCE_LIMIT) {
          groups.balances.push(client.name + ' — осталось ' + remaining);
          affected[client.id] = client;
        }
        const block = getTelegramBlockRecord_(row[3]);
        if (block && block.status === 'Приостановлен') {
          groups.blocks.push(client.name + ' — блок на паузе');
          affected[client.id] = client;
        } else if (block && block.status === 'Планируется' &&
            block.startDate instanceof Date && block.startDate <= now) {
          groups.blocks.push(client.name + ' — пора активировать ' + block.id);
          affected[client.id] = client;
        }
      } else if (!singlePrice) {
        groups.blocks.push(client.name + ' — нет активного блока');
        affected[client.id] = client;
      }
    });
  }

  const queueLastRow = queueSheet.getLastRow();
  if (queueLastRow >= DMS_TELEGRAM_ATTENTION.QUEUE_FIRST_ROW) {
    queueSheet.getRange(
      DMS_TELEGRAM_ATTENTION.QUEUE_FIRST_ROW,
      1,
      queueLastRow - DMS_TELEGRAM_ATTENTION.QUEUE_FIRST_ROW + 1,
      DMS_TELEGRAM_ATTENTION.QUEUE_COLUMNS
    ).getValues().forEach(function(row) {
      if (!row[0] || row[13] === 'Обработано') return;
      const end = row[6];
      if (!(end instanceof Date) || end > now) return;
      const dateText = Utilities.formatDate(end, timeZone, 'dd.MM HH:mm');
      const clientName = String(row[9] || row[7] || 'Неизвестное событие');
      const reason = row[11] !== 'Распознано'
        ? 'не распознано'
        : row[13] === 'Ошибка' ? 'ошибка обработки' : 'ждёт подтверждения';
      groups.queue.push(dateText + ' · ' + clientName + ' — ' + reason);
      if (row[8]) affected[String(row[8])] = {id: String(row[8]), name: clientName};
    });
  }

  const lines = ['<b>⚠️ Требует внимания</b>'];
  appendTelegramAttentionGroup_(lines, 'Неподтверждённые тренировки', groups.queue);
  appendTelegramAttentionGroup_(lines, 'Задолженность', groups.debts);
  appendTelegramAttentionGroup_(lines, 'Заканчиваются тренировки', groups.balances);
  appendTelegramAttentionGroup_(lines, 'Блоки', groups.blocks);

  const total = groups.queue.length + groups.debts.length +
    groups.balances.length + groups.blocks.length;
  if (!total) lines.push('', '✅ Всё в порядке. Открытых вопросов нет.');
  else lines.push('', 'Всего пунктов: <b>' + total + '</b>');

  return {
    text: lines.join('\n'),
    clients: Object.keys(affected).map(function(id) { return affected[id]; })
      .sort(function(a, b) { return a.name.localeCompare(b.name, 'ru'); })
  };
}

function appendTelegramAttentionGroup_(lines, title, items) {
  if (!items.length) return;
  lines.push('', '<b>' + escapeTelegramHtml_(title) + '</b>');
  items.forEach(function(item) {
    lines.push('• ' + escapeTelegramHtml_(item));
  });
}

function telegramHelpTextLegacyV9_() {
  return [
    '<b>Основные действия доступны кнопками внизу.</b>',
    '',
    '<b>Команды на случай ручного ввода</b>',
    '/menu — показать кнопки',
    '/attention — всё, что требует внимания',
    '/schedule — записать тренировку',
    '/today — подтвердить сегодняшний день',
    '/yesterday — проверить вчерашний день',
    '/clients — клиенты, блоки, заметки и оплаты',
    '/client имя — найти клиента',
    '/balances — остатки тренировок',
    '/debt — долги клиентов',
    '/report — отчёт за выбранный месяц',
    '/cancel — отменить текущее действие'
  ].join('\n');
}




// DMS Telegram planned-block status compatibility hotfix v10.
function createTelegramBlockRow_(state, clientId) {
  const ss = SpreadsheetApp.getActive();
  const blocks = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.BLOCKS);
  const blockId = makeNextTelegramEntityId_(
    blocks,
    DMS_TELEGRAM_MANAGEMENT.BLOCK_FIRST_ROW,
    'BL'
  );
  const blockRow = findTelegramEmptyEntityRow_(blocks, DMS_TELEGRAM_MANAGEMENT.BLOCK_FIRST_ROW);
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const startDate = Utilities.parseDate(
    state.blockDateKey + ' 12:00',
    timeZone,
    'yyyy-MM-dd HH:mm'
  );
  const price = Number(state.blockPrice) || 0;
  const count = Number(state.blockCount) || 0;
  const todayKey = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  const status = state.blockDateKey > todayKey ? 'Запланирован' : 'Активен';

  prepareTelegramEntityRow_(
    blocks,
    blockRow,
    DMS_TELEGRAM_MANAGEMENT.BLOCK_FIRST_ROW,
    DMS_TELEGRAM_MANAGEMENT.BLOCK_COLUMNS
  );
  blocks.getRange(blockRow, 1, 1, 8).setValues([[
    blockId,
    clientId,
    'Блок ' + count,
    status,
    startDate,
    '',
    '',
    count
  ]]);
  setTelegramBlockStatus_(blocks, blockRow, status);
  blocks.getRange(blockRow, 11).setValue(price);
  blocks.getRange(blockRow, 13).clearContent();
  blocks.getRange(blockRow, 16).setValue(
    'Создан через Telegram ' + Utilities.formatDate(new Date(), timeZone, 'dd.MM.yyyy')
  );
  blocks.getRange(blockRow, 17).insertCheckboxes().setValue(false);
  return blockId;
}

function setTelegramBlockStatus_(sheet, row, status) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Запланирован', 'Активен', 'Приостановлен', 'Закрыт'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(row, 4).setDataValidation(rule).setValue(status);
}


// DMS Telegram expanded monthly report and calendar forecast v11.
const DMS_TELEGRAM_REPORT_V11 = {
  SETTINGS: 'Настройки',
  CLIENTS: 'Клиенты',
  BLOCKS: 'Блоки',
  REPORT: 'Отчёт',
  BLOCK_FIRST_ROW: 4,
  BLOCK_COLUMNS: 12
};

function buildTelegramReportText_() {
  const ss = SpreadsheetApp.getActive();
  const report = getRequiredSheet_(ss, DMS_TELEGRAM_REPORT_V11.REPORT);
  const month = report.getRange('B3').getDisplayValue();
  const rows = report.getRange('A6:B17').getDisplayValues();
  const wanted = {
    'Проведено тренировок': true,
    'Всего заработано работой': true,
    'Получено денег': true,
    'Оплаченные рабочие расходы': true,
    'Денежный результат': true,
    'Дебиторская задолженность': true
  };
  const lines = ['<b>Отчёт — ' + escapeTelegramHtml_(month) + '</b>'];
  const metrics = {};

  rows.forEach(function(row) {
    if (!wanted[row[0]]) return;
    metrics[row[0]] = row[1];
    lines.push('• ' + escapeTelegramHtml_(row[0]) + ': <b>' +
      escapeTelegramHtml_(row[1]) + '</b>');
  });

  const operational = getTelegramOperationalMetrics_();
  lines.push(
    '',
    '<b>Текущее состояние</b>',
    '• Активных клиентов: <b>' + operational.activeClients + '</b>',
    '• Активных/запланированных блоков: <b>' + operational.openBlocks + '</b>',
    '• Блоков с остатком 0–2: <b>' + operational.lowBlocks + '</b>',
    '• Клиентов с долгом: <b>' + operational.debtClients + '</b>'
  );

  try {
    const forecast = getTelegramCalendarForecast_();
    lines.push(
      '',
      '<b>Прогноз до конца ' + escapeTelegramHtml_(forecast.monthName) + '</b>',
      '• Запланировано тренировок: <b>' + forecast.trainingCount + '</b>',
      '• Стоимость предстоящей работы: <b>' +
        escapeTelegramHtml_(formatTelegramMoney_(forecast.workValue)) + '</b>'
    );
    if (forecast.unrecognizedCount) {
      lines.push('• Не распознано событий ПТ: <b>' + forecast.unrecognizedCount + '</b>');
    }
    const earned = parseTelegramMoney_(metrics['Всего заработано работой']);
    if (earned || forecast.workValue) {
      lines.push('• Работа за месяц с учётом расписания: <b>' +
        escapeTelegramHtml_(formatTelegramMoney_(earned + forecast.workValue)) + '</b>');
    }
  } catch (error) {
    lines.push(
      '',
      '<b>Прогноз по календарю</b>',
      '• Не удалось рассчитать: ' + escapeTelegramHtml_(error.message || String(error))
    );
  }

  return lines.join('\n');
}

function getTelegramOperationalMetrics_() {
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM_REPORT_V11.CLIENTS);
  const lastRow = clients.getLastRow();
  const result = {
    activeClients: 0,
    openBlocks: 0,
    lowBlocks: 0,
    debtClients: 0
  };
  if (lastRow < DMS_TELEGRAM.CLIENT_FIRST_ROW) return result;

  clients.getRange(
    DMS_TELEGRAM.CLIENT_FIRST_ROW,
    1,
    lastRow - DMS_TELEGRAM.CLIENT_FIRST_ROW + 1,
    DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS
  ).getDisplayValues().forEach(function(row) {
    if (!row[0] || row[2] !== 'Активен') return;
    result.activeClients++;
    if (parseTelegramMoney_(row[9]) > 0) result.debtClients++;
    if (!row[3]) return;
    result.openBlocks++;
    const remaining = Number(String(row[6] || '').replace(/[^\d.-]/g, ''));
    if (!isNaN(remaining) && remaining <= 2) result.lowBlocks++;
  });
  return result;
}

function getTelegramCalendarForecast_() {
  const ss = SpreadsheetApp.getActive();
  const settings = getRequiredSheet_(ss, DMS_TELEGRAM_REPORT_V11.SETTINGS);
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM_REPORT_V11.CLIENTS);
  const blocks = getRequiredSheet_(ss, DMS_TELEGRAM_REPORT_V11.BLOCKS);
  const config = getCalendarSyncSettings_(settings);
  const clientMap = buildCalendarClientMap_(clients);
  const blockPrices = getTelegramBlockTrainingPrices_(blocks);
  const now = new Date();
  const year = Number(Utilities.formatDate(now, config.timeZone, 'yyyy'));
  const month = Number(Utilities.formatDate(now, config.timeZone, 'MM'));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthNumber = month === 12 ? 1 : month + 1;
  const nextMonth = Utilities.parseDate(
    nextYear + '-' + String(nextMonthNumber).padStart(2, '0') + '-01 00:00',
    config.timeZone,
    'yyyy-MM-dd HH:mm'
  );
  const events = listCalendarEvents_(config.calendarId, now, nextMonth, config.timeZone);
  let trainingCount = 0;
  let unrecognizedCount = 0;
  let workValue = 0;

  events.forEach(function(event) {
    if (event.status === 'cancelled') return;
    const title = String(event.summary || '').trim();
    if (!isTrainingEventTitle_(title)) return;
    const times = getCalendarEventTimes_(event);
    if (!times || times.start < now) return;
    const client = clientMap[normalizeCalendarTitle_(title)] || null;
    if (!client) {
      unrecognizedCount++;
      return;
    }
    trainingCount++;
    if (client.blockId && blockPrices[client.blockId] !== undefined) {
      workValue += blockPrices[client.blockId];
    } else {
      workValue += Number(client.singlePrice) || 0;
    }
  });

  return {
    trainingCount: trainingCount,
    unrecognizedCount: unrecognizedCount,
    workValue: workValue,
    monthName: Utilities.formatDate(now, config.timeZone, 'MM.yyyy')
  };
}

function getTelegramBlockTrainingPrices_(blocks) {
  const result = {};
  const lastRow = blocks.getLastRow();
  if (lastRow < DMS_TELEGRAM_REPORT_V11.BLOCK_FIRST_ROW) return result;
  blocks.getRange(
    DMS_TELEGRAM_REPORT_V11.BLOCK_FIRST_ROW,
    1,
    lastRow - DMS_TELEGRAM_REPORT_V11.BLOCK_FIRST_ROW + 1,
    DMS_TELEGRAM_REPORT_V11.BLOCK_COLUMNS
  ).getValues().forEach(function(row) {
    if (!row[0]) return;
    result[String(row[0])] = Number(row[11]) || 0;
  });
  return result;
}


// DMS Telegram compact main keyboard layout v12.
function buildTelegramMainKeyboardLegacyV12_() {
  return {
    keyboard: [
      [{text: '📅 Сегодня'}, {text: '⏮ Вчера'}],
      [{text: '➕ Записать'}, {text: '⚠️ Внимание'}],
      [{text: '👥 Клиенты'}, {text: '📦 Остатки'}],
      [{text: '💳 Долги'}, {text: '📊 Отчёт'}],
      [{text: '🏠 Меню'}]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Выбери действие'
  };
}
