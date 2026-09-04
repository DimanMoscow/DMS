// DMS Fitness Telegram Mini App menu integration v35.
const DMS_MINI_APP_TELEGRAM = {
  PRODUCTION_URL: '__DMS_MINI_APP_PRODUCTION_URL__',
  BUTTON_TEXT: 'DMS Fitness'
};

/**
 * Installs the global Telegram chat menu button for the production Mini App.
 * The bot token stays in Script Properties and is never returned or logged.
 */
function configureDmsMiniAppMenuButton() {
  validateTelegramConfiguration_();
  telegramApi_('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: DMS_MINI_APP_TELEGRAM.BUTTON_TEXT,
      web_app: {url: DMS_MINI_APP_TELEGRAM.PRODUCTION_URL}
    }
  });

  const status = getDmsMiniAppMenuButtonStatus();
  if (!status.ok) throw new Error('Telegram не подтвердил кнопку Mini App.');
  console.log(JSON.stringify(status));
  return status;
}

/** Read-only verification of the active global Telegram chat menu button. */
function getDmsMiniAppMenuButtonStatus() {
  const button = telegramApi_('getChatMenuButton', {}) || {};
  const url = button.web_app && button.web_app.url ? String(button.web_app.url) : '';
  const status = {
    ok: button.type === 'web_app' &&
      String(button.text || '') === DMS_MINI_APP_TELEGRAM.BUTTON_TEXT &&
      normalizeDmsMiniAppUrl_(url) ===
        normalizeDmsMiniAppUrl_(DMS_MINI_APP_TELEGRAM.PRODUCTION_URL),
    type: String(button.type || ''),
    text: String(button.text || ''),
    url: url
  };
  console.log(JSON.stringify(status));
  return status;
}


function normalizeDmsMiniAppUrl_(value) {
  return String(value || '').replace(/\/+$/, '');
}