const DMS_SCHEDULED_AUTOMATION = {
  MANIFEST_PROPERTY: 'DMS_SCHEDULED_AUTOMATION_MANIFEST_V1',
  SUCCESS_PROPERTY: 'DMS_SCHEDULED_AUTOMATION_SUCCESS_V1',
  VERSION: 1,
  TIME_ZONE: 'Europe/Moscow',
  DAILY_GRACE_MINUTES: 75,
  SPECS: [
    {handler: 'createDmsAutomaticBackup', cadence: 'daily', every: 1, hour: 3},
    {handler: 'sendTelegramMorningDigest', cadence: 'daily', every: 1, hour: 8,
      setting: 'morning'},
    {handler: 'sendTelegramDailyQueue', cadence: 'daily', every: 1, hour: 22,
      setting: 'evening'},
    {handler: 'syncCalendarToQueue', cadence: 'hourly', every: 1,
      maxAgeMinutes: 105},
    {handler: 'runDmsWatchdog', cadence: 'hourly', every: 2,
      maxAgeMinutes: 165}
  ]
};

// A new HEAD starts closed. Only the verified, drained v52 rollout may enable
// business mutations. Scheduled health metadata is maintained separately.
function assertDmsP1ReleaseReady_() {
  if (PropertiesService.getScriptProperties().getProperty('DMS_P1_RELEASE_READY') !== 'v52') {
    throw new Error('DMS release maintenance: mutations are paused.');
  }
}

function hashDmsScheduledAutomationValue_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function getDmsScheduledAutomationOwnerKey_() {
  try {
    const email = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
    return email ? hashDmsScheduledAutomationValue_('owner|' + email) : '';
  } catch (ignore) {
    return '';
  }
}

function getDmsScheduledAutomationSpecRecord_(spec) {
  const record = {
    handler: spec.handler,
    cadence: spec.cadence,
    every: spec.every,
    timeZone: DMS_SCHEDULED_AUTOMATION.TIME_ZONE
  };
  if (spec.cadence === 'daily') record.hour = spec.hour;
  return record;
}

function getDmsScheduledAutomationSpecSignature_() {
  return hashDmsScheduledAutomationValue_(JSON.stringify(
    DMS_SCHEDULED_AUTOMATION.SPECS.map(getDmsScheduledAutomationSpecRecord_)
  ));
}

function getDmsScheduledAutomationManifest_() {
  const raw = PropertiesService.getScriptProperties().getProperty(
    DMS_SCHEDULED_AUTOMATION.MANIFEST_PROPERTY
  );
  if (!raw) return null;
  try {
    const manifest = JSON.parse(raw);
    return manifest && typeof manifest === 'object' ? manifest : null;
  } catch (ignore) {
    return null;
  }
}

function getDmsScheduledAutomationSuccesses_() {
  const raw = PropertiesService.getScriptProperties().getProperty(
    DMS_SCHEDULED_AUTOMATION.SUCCESS_PROPERTY
  );
  if (!raw) return {};
  try {
    const records = JSON.parse(raw);
    return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
  } catch (ignore) {
    return {};
  }
}

function findDmsScheduledAutomationManifestTrigger_(manifest, handler) {
  if (!manifest || !Array.isArray(manifest.triggers)) return null;
  const matches = manifest.triggers.filter(function(item) {
    return item && item.handler === handler;
  });
  return matches.length === 1 ? matches[0] : null;
}

function assertDmsScheduledInvocation_(handler, event) {
  const triggerUid = event && event.triggerUid ? String(event.triggerUid) : '';
  if (!triggerUid) return null;
  const manifest = getDmsScheduledAutomationManifest_();
  const expected = findDmsScheduledAutomationManifestTrigger_(manifest, handler);
  const ownerKey = getDmsScheduledAutomationOwnerKey_();
  if (!expected || expected.id !== triggerUid || !ownerKey || manifest.ownerKey !== ownerKey) {
    throw new Error('DMS scheduled trigger identity mismatch.');
  }
  return triggerUid;
}

function recordDmsScheduledAutomationSuccess_(handler, event, outcome) {
  const triggerUid = event && event.triggerUid ? String(event.triggerUid) : '';
  if (!triggerUid) return;
  const allowedOutcomes = {
    sent: true, empty: true, disabled: true, completed: true,
    healthy: true, alerted: true, deduplicated: true
  };
  if (!allowedOutcomes[outcome]) throw new Error('DMS scheduled outcome is invalid.');
  const lease = getDmsMutationLock_();
  if (!lease.tryLock(10000)) throw new Error('DMS scheduled health update is busy.');
  try {
    const manifest = getDmsScheduledAutomationManifest_();
    const expected = findDmsScheduledAutomationManifestTrigger_(manifest, handler);
    if (!expected || expected.id !== triggerUid) {
      throw new Error('DMS scheduled trigger identity mismatch.');
    }
    const records = getDmsScheduledAutomationSuccesses_();
    records[handler] = {
      triggerId: triggerUid,
      lastSuccessAt: new Date().toISOString(),
      outcome: outcome
    };
    PropertiesService.getScriptProperties().setProperty(
      DMS_SCHEDULED_AUTOMATION.SUCCESS_PROPERTY,
      JSON.stringify(records)
    );
  } finally {
    lease.releaseLock();
  }
}

function createDmsScheduledAutomationTrigger_(spec) {
  let builder = ScriptApp.newTrigger(spec.handler).timeBased();
  if (spec.cadence === 'daily') {
    builder = builder.atHour(spec.hour).everyDays(spec.every)
      .inTimezone(DMS_SCHEDULED_AUTOMATION.TIME_ZONE);
  } else if (spec.cadence === 'hourly') {
    builder = builder.everyHours(spec.every);
  } else {
    throw new Error('Unsupported DMS trigger cadence.');
  }
  return builder.create();
}

// Installs the entire schedule as one managed set. New triggers are created
// before the old set is removed, and partial new sets are cleaned up on error.
function installDmsScheduledAutomation() {
  const mutex = LockService.getScriptLock();
  if (!mutex || !mutex.tryLock(10000)) throw new Error('Script lock unavailable.');
  try {
    return installDmsScheduledAutomationLocked_();
  } finally {
    mutex.releaseLock();
  }
}

function installDmsScheduledAutomationLocked_() {
  if (!PropertiesService.getDocumentProperties()) {
    throw new Error('Original document context required.');
  }
  if (PropertiesService.getScriptProperties().getProperty('DMS_P1_RELEASE_READY') === 'v52') {
    throw new Error('Pause the v52 release before replacing scheduled triggers.');
  }
  const scriptTimeZone = String(Session.getScriptTimeZone() || '');
  const sheetTimeZone = String(SpreadsheetApp.getActive().getSpreadsheetTimeZone() || '');
  if (scriptTimeZone !== DMS_SCHEDULED_AUTOMATION.TIME_ZONE ||
      sheetTimeZone !== DMS_SCHEDULED_AUTOMATION.TIME_ZONE) {
    throw new Error('DMS scheduled automation requires Europe/Moscow.');
  }
  const ownerKey = getDmsScheduledAutomationOwnerKey_();
  if (!ownerKey) throw new Error('DMS trigger owner identity is unavailable.');
  const notificationSettings = getTelegramFinalSettings_();
  if (notificationSettings.morning !== true || notificationSettings.evening !== true) {
    throw new Error('DMS morning/evening notifications must be enabled before trigger installation.');
  }

  const handlers = DMS_SCHEDULED_AUTOMATION.SPECS.map(function(spec) { return spec.handler; });
  const previous = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return handlers.indexOf(trigger.getHandlerFunction()) !== -1;
  });
  const created = [];
  let manifestWritten = false;
  try {
    DMS_SCHEDULED_AUTOMATION.SPECS.forEach(function(spec) {
      created.push(createDmsScheduledAutomationTrigger_(spec));
    });
    created.forEach(function(trigger, index) {
      if (trigger.getHandlerFunction() !== DMS_SCHEDULED_AUTOMATION.SPECS[index].handler ||
          trigger.getEventType() !== ScriptApp.EventType.CLOCK ||
          trigger.getTriggerSource() !== ScriptApp.TriggerSource.CLOCK) {
        throw new Error('Created DMS trigger failed identity validation.');
      }
    });
    const manifest = {
      version: DMS_SCHEDULED_AUTOMATION.VERSION,
      installedAt: new Date().toISOString(),
      ownerKey: ownerKey,
      timeZone: DMS_SCHEDULED_AUTOMATION.TIME_ZONE,
      specSignature: getDmsScheduledAutomationSpecSignature_(),
      triggers: created.map(function(trigger, index) {
        const record = getDmsScheduledAutomationSpecRecord_(DMS_SCHEDULED_AUTOMATION.SPECS[index]);
        record.id = String(trigger.getUniqueId());
        return record;
      })
    };
    const properties = PropertiesService.getScriptProperties();
    properties.setProperty(DMS_SCHEDULED_AUTOMATION.MANIFEST_PROPERTY, JSON.stringify(manifest));
    manifestWritten = true;
    properties.deleteProperty(DMS_SCHEDULED_AUTOMATION.SUCCESS_PROPERTY);
    previous.forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
    const health = getDmsScheduledAutomationHealth_({requireFreshness: false});
    if (!health.configOk || !health.settingsOk) {
      throw new Error('Installed DMS trigger set failed the configuration gate.');
    }
    return {
      configured: true,
      handlers: handlers,
      timeZone: health.timeZone,
      ownerVerified: health.ownerVerified,
      freshnessPending: true
    };
  } catch (error) {
    if (!manifestWritten) {
      created.forEach(function(trigger) {
        try { ScriptApp.deleteTrigger(trigger); } catch (ignore) {}
      });
    } else {
      previous.forEach(function(trigger) {
        try { ScriptApp.deleteTrigger(trigger); } catch (ignore) {}
      });
    }
    throw error;
  }
}

function isDmsScheduledHandlerAvailable_(handler) {
  const available = {
    createDmsAutomaticBackup: typeof createDmsAutomaticBackup === 'function',
    sendTelegramMorningDigest: typeof sendTelegramMorningDigest === 'function',
    sendTelegramDailyQueue: typeof sendTelegramDailyQueue === 'function',
    syncCalendarToQueue: typeof syncCalendarToQueue === 'function',
    runDmsWatchdog: typeof runDmsWatchdog === 'function'
  };
  return available[handler] === true;
}

function getDmsExpectedDailySuccessAfter_(spec, now) {
  const timeZone = DMS_SCHEDULED_AUTOMATION.TIME_ZONE;
  const today = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd');
  const windowStart = Utilities.parseDate(
    today + ' ' + String(spec.hour).padStart(2, '0') + ':00',
    timeZone,
    'yyyy-MM-dd HH:mm'
  );
  const graceMs = DMS_SCHEDULED_AUTOMATION.DAILY_GRACE_MINUTES * 60 * 1000;
  if (now.getTime() >= windowStart.getTime() + graceMs) return windowStart;
  const priorProbe = new Date(windowStart.getTime() - 36 * 60 * 60 * 1000);
  const priorDate = Utilities.formatDate(priorProbe, timeZone, 'yyyy-MM-dd');
  return Utilities.parseDate(
    priorDate + ' ' + String(spec.hour).padStart(2, '0') + ':00',
    timeZone,
    'yyyy-MM-dd HH:mm'
  );
}

function getDmsScheduledAutomationHealth_(options) {
  const settings = options || {};
  const requireFreshness = settings.requireFreshness !== false;
  const now = settings.now instanceof Date ? settings.now : new Date();
  const manifest = getDmsScheduledAutomationManifest_();
  const successes = getDmsScheduledAutomationSuccesses_();
  const actual = ScriptApp.getProjectTriggers();
  const ownerKey = getDmsScheduledAutomationOwnerKey_();
  const scriptTimeZone = String(Session.getScriptTimeZone() || '');
  const sheetTimeZone = String(SpreadsheetApp.getActive().getSpreadsheetTimeZone() || '');
  const manifestShapeOk = !!manifest &&
    manifest.version === DMS_SCHEDULED_AUTOMATION.VERSION &&
    manifest.timeZone === DMS_SCHEDULED_AUTOMATION.TIME_ZONE &&
    manifest.specSignature === getDmsScheduledAutomationSpecSignature_() &&
    Array.isArray(manifest.triggers) &&
    manifest.triggers.length === DMS_SCHEDULED_AUTOMATION.SPECS.length;
  const ownerVerified = !!ownerKey && manifestShapeOk && manifest.ownerKey === ownerKey;
  const notificationSettings = getTelegramFinalSettings_();

  const handlers = DMS_SCHEDULED_AUTOMATION.SPECS.map(function(spec) {
    const triggers = actual.filter(function(trigger) {
      return trigger.getHandlerFunction() === spec.handler;
    });
    const recorded = findDmsScheduledAutomationManifestTrigger_(manifest, spec.handler);
    const trigger = triggers.length === 1 ? triggers[0] : null;
    const schedule = getDmsScheduledAutomationSpecRecord_(spec);
    const recordedSchedule = recorded ? {
      handler: recorded.handler,
      cadence: recorded.cadence,
      every: recorded.every,
      timeZone: recorded.timeZone
    } : null;
    if (recordedSchedule && recorded.hour !== undefined) recordedSchedule.hour = recorded.hour;
    const configOk = isDmsScheduledHandlerAvailable_(spec.handler) && !!trigger && !!recorded &&
      trigger.getEventType() === ScriptApp.EventType.CLOCK &&
      trigger.getTriggerSource() === ScriptApp.TriggerSource.CLOCK &&
      String(trigger.getUniqueId()) === recorded.id &&
      JSON.stringify(schedule) === JSON.stringify(recordedSchedule);
    const success = successes[spec.handler];
    const lastSuccess = success && success.triggerId === (recorded && recorded.id) &&
      isFinite(Date.parse(success.lastSuccessAt)) ? new Date(success.lastSuccessAt) : null;
    const expectedAfter = spec.cadence === 'daily'
      ? getDmsExpectedDailySuccessAfter_(spec, now)
      : new Date(now.getTime() - spec.maxAgeMinutes * 60 * 1000);
    const fresh = !!lastSuccess && lastSuccess.getTime() >= expectedAfter.getTime() &&
      lastSuccess.getTime() <= now.getTime() + 60000;
    const enabled = !spec.setting || notificationSettings[spec.setting] === true;
    return {
      handler: spec.handler,
      available: isDmsScheduledHandlerAvailable_(spec.handler),
      presentExactlyOnce: triggers.length === 1,
      configOk: configOk,
      schedule: schedule,
      enabled: enabled,
      lastSuccessAt: lastSuccess ? lastSuccess.toISOString() : null,
      expectedSuccessAfter: expectedAfter.toISOString(),
      fresh: fresh
    };
  });
  const configOk = manifestShapeOk && ownerVerified &&
    scriptTimeZone === DMS_SCHEDULED_AUTOMATION.TIME_ZONE &&
    sheetTimeZone === DMS_SCHEDULED_AUTOMATION.TIME_ZONE &&
    handlers.every(function(item) { return item.configOk; });
  const settingsOk = handlers.every(function(item) { return item.enabled; });
  const freshnessOk = handlers.every(function(item) { return item.fresh; });
  return {
    ok: configOk && settingsOk && (!requireFreshness || freshnessOk),
    checkedAt: now.toISOString(),
    timeZone: {
      expected: DMS_SCHEDULED_AUTOMATION.TIME_ZONE,
      script: scriptTimeZone,
      spreadsheet: sheetTimeZone
    },
    ownerVerified: ownerVerified,
    configOk: configOk,
    settingsOk: settingsOk,
    freshnessOk: freshnessOk,
    requireFreshness: requireFreshness,
    handlers: handlers
  };
}

function getDmsScheduledAutomationHealth() {
  const report = getDmsScheduledAutomationHealth_({requireFreshness: true});
  console.log(JSON.stringify(report));
  return report;
}

// Run in the original bound document, never in a web-app context. Output is
// counts and redacted health only; raw operational identifiers stay private.
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
  const scheduled = getDmsScheduledAutomationHealth_({requireFreshness: true});
  const report = {checkedAt: new Date().toISOString(), originalDocumentContext: true,
    usage: getDmsPropertyUsage_(), legacyStates: states, ledgerRows: count, ledgerEvents: events,
    mutationReady: PropertiesService.getScriptProperties().getProperty('DMS_P1_RELEASE_READY') === 'v52',
    scheduledAutomation: {ok: scheduled.ok, configOk: scheduled.configOk,
      settingsOk: scheduled.settingsOk, freshnessOk: scheduled.freshnessOk},
    drainStartedAt: PropertiesService.getScriptProperties().getProperty('DMS_P1_DRAIN_STARTED_AT') || null,
    scriptLockAvailable: !!LockService.getScriptLock(), documentLockAvailable: !!LockService.getDocumentLock()};
  console.log(JSON.stringify(report));
  return report;
}

// Called after v52 HEAD is independently read back. It converts the active v51
// marker into a closed state and starts the old-execution drain timer.
function startDmsP1ExecutionDrain() {
  const properties = PropertiesService.getScriptProperties();
  const ready = properties.getProperty('DMS_P1_RELEASE_READY') || '';
  if (ready === 'v52') throw new Error('Release is already enabled.');
  if (ready && ready !== 'v51') throw new Error('Unexpected release marker.');
  properties.deleteProperty('DMS_P1_RELEASE_READY');
  const startedAt = new Date().toISOString();
  properties.setProperty('DMS_P1_DRAIN_STARTED_AT', startedAt);
  console.log(JSON.stringify({drainStartedAt: startedAt, minimumWaitSeconds: 420}));
}

// Activation is the last write gate after source read-back, trigger installation,
// old-execution drain and the existing schema/numeric checks.
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
    const scheduled = getDmsScheduledAutomationHealth_({requireFreshness: false});
    if (!scheduled.configOk || !scheduled.settingsOk) {
      throw new Error('Scheduled automation configuration gate failed.');
    }
    const inventory = inspectDmsP1ReleaseState();
    if (inventory.legacyStates.malformed) throw new Error('Malformed legacy evidence requires private recovery.');
    properties.setProperty('DMS_P1_RELEASE_READY', 'v52');
    console.log(JSON.stringify({mutationReady: true, financialGate: true,
      scheduledConfigurationGate: true, scheduledFreshnessPending: !scheduled.freshnessOk,
      legacyEvidenceRetained: true}));
  } finally { mutex.releaseLock(); }
}
