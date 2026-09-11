// Owner-only, paused-release recovery. The private plan contains the approved
// business facts; no client data or operational identifiers are source controlled.
const DMS_EMERGENCY_RECOVERY = {
  PLAN_NAME: 'DMS Emergency Recovery Approved Plan',
  ACCEPTED: 'DMS_EMERGENCY_RECOVERY_ACCEPTED_V1',
  RESULT: 'DMS_EMERGENCY_RECOVERY_RESULT_V1'
};

function decodeDmsRecoveryCell_(value) {
  if (value && typeof value === 'object' && Object.keys(value).join() === 'date') {
    const date = new Date(value.date);
    if (!isFinite(date.getTime())) throw new Error('Invalid recovery date.');
    return date;
  }
  if (typeof value === 'string' && value.charAt(0) !== '=' ||
      typeof value === 'number' && isFinite(value) || typeof value === 'boolean') return value;
  throw new Error('Invalid recovery cell.');
}

function validateDmsRecoveryPatch_(patch) {
  if (!patch || !Number.isSafeInteger(patch.row) || patch.row < 4 ||
      !Array.isArray(patch.before) || !Array.isArray(patch.after) ||
      patch.before.length !== patch.after.length) throw new Error('Invalid recovery patch.');
  const width = patch.after.length;
  const isBlank = patch.before.every(function(v) {return v === '';});
  if (patch.kind === 'single_payment') {
    if (patch.sheet !== 'Оплаты' || patch.col !== 1 || width !== 10 || !isBlank ||
        !/^OP-\d+$/.test(patch.after[0]) || !/^CL-\d+$/.test(patch.after[2]) || patch.after[3] !== '' ||
        patch.after[4] !== 'Оплата' || patch.after[5] !== 'Перевод' ||
        !(patch.after[6] > 0) || patch.after[7] !== 'Подтверждён') throw new Error('Invalid single-payment recovery.');
  } else if (patch.kind === 'advance') {
    if (patch.sheet !== 'Оплаты' || patch.col !== 1 || width !== 10 ||
        !/^BL-\d+$/.test(patch.after[3]) || !/^BL-\d+$/.test(patch.before[3]) ||
        patch.before[7] !== 'Подтверждён' ||
        [0,1,2,4,5,6,7,8].some(function(i) {
          return canonicalTelegramConfirmationJson_(patch.before[i]) !== canonicalTelegramConfirmationJson_(patch.after[i]);
        })) throw new Error('Advance recovery may change only its block and explanation.');
  } else if (patch.kind === 'unit_price') {
    if (patch.sheet !== 'Блоки' || patch.col !== 12 || width !== 1 || !isBlank ||
        !(patch.after[0] > 0)) throw new Error('Unit-price recovery must fill an empty price.');
  } else if (patch.kind === 'planned_block') {
    const emptyInputs = isBlank || patch.col === 16 && patch.before[0] === '' && patch.before[1] === false;
    if (patch.sheet !== 'Блоки' || !emptyInputs || !(
      patch.col === 1 && width === 8 && /^BL-\d+$/.test(patch.after[0]) && /^CL-\d+$/.test(patch.after[1]) &&
        patch.after[3] === 'Запланирован' && Number.isSafeInteger(patch.after[7]) && patch.after[7] > 0 ||
      patch.col === 11 && width === 2 && patch.after.every(function(v) {return Number.isFinite(v) && v > 0;}) ||
      patch.col === 16 && width === 2 && typeof patch.after[0] === 'string' && patch.after[1] === false
    )) throw new Error('Invalid planned-block recovery.');
  } else throw new Error('Recovery patch kind is not permitted.');
  patch.before.forEach(decodeDmsRecoveryCell_);
  patch.after.forEach(decodeDmsRecoveryCell_);
}

function loadDmsEmergencyRecoveryPlan_() {
  if (!PropertiesService.getDocumentProperties()) throw new Error('Original document context required.');
  const manifest = getDmsScheduledAutomationManifest_();
  if (!manifest || manifest.ownerKey !== getDmsScheduledAutomationOwnerKey_()) throw new Error('Verified owner required.');
  const files = DriveApp.getFilesByName(DMS_EMERGENCY_RECOVERY.PLAN_NAME);
  if (!files.hasNext()) throw new Error('Private recovery plan unavailable.');
  const file = files.next();
  if (files.hasNext() || file.getOwner().getEmail().toLowerCase() !== Session.getEffectiveUser().getEmail().toLowerCase()) {
    throw new Error('Private recovery plan ownership or uniqueness differs.');
  }
  const raw = file.getBlob().getDataAsString(); const plan = JSON.parse(raw);
  if (plan.formatVersion !== 1 || plan.releaseMarker !== DMS_RELEASE_READY_MARKER ||
      plan.spreadsheetId !== SpreadsheetApp.getActive().getId() || !Array.isArray(plan.patches) ||
      plan.patches.length < 1 || plan.patches.length > 32 || !Array.isArray(plan.guards) || !plan.guards.length ||
      !/^[a-f0-9]{64}$/.test(plan.migrationLedgerSha256) ||
      !plan.backup || plan.backup.restoreVerified !== true || !/^[a-f0-9]{64}$/.test(plan.backup.manifestSha256) ||
      Date.now() - Date.parse(plan.backup.verifiedAt) < 0 ||
      !(Date.now() - Date.parse(plan.backup.verifiedAt) < 7200000)) throw new Error('Recovery plan or fresh restore evidence invalid.');
  const cells = {};
  plan.patches.forEach(function(patch) {
    validateDmsRecoveryPatch_(patch);
    patch.after.forEach(function(_, i) {
      const key = patch.sheet + '|' + patch.row + '|' + (patch.col + i);
      if (cells[key]) throw new Error('Overlapping recovery patches.');
      cells[key] = true;
    });
  });
  plan.guards.forEach(function(guard) {
    if (['Клиенты', 'Блоки', 'Оплаты', 'Журнал тренировок'].indexOf(guard.sheet) === -1 ||
        !Number.isSafeInteger(guard.row) || guard.row < 4 || !Number.isSafeInteger(guard.col) || guard.col < 1 ||
        !Array.isArray(guard.values) || !guard.values.length || guard.col + guard.values.length > 20) {
      throw new Error('Invalid recovery identity guard.');
    }
    const current = getRequiredSheet_(SpreadsheetApp.getActive(), guard.sheet)
      .getRange(guard.row, guard.col, 1, guard.values.length).getValues()[0];
    if (canonicalTelegramConfirmationJson_(current) !== canonicalTelegramConfirmationJson_(guard.values.map(decodeDmsRecoveryCell_))) {
      throw new Error('Recovery identity or entitlement changed.');
    }
  });
  if (plan.calendarGuard) {
    const guard = plan.calendarGuard;
    const events = Calendar.Events.list(guard.calendarId, {timeMin:guard.start, timeMax:guard.end,
      singleEvents:true, showDeleted:false, maxResults:100});
    if (events.nextPageToken || (events.items || []).filter(function(event) {
      return event.status !== 'cancelled' && event.summary === guard.title &&
        Date.parse(event.start && event.start.dateTime) === Date.parse(guard.start) &&
        Date.parse(event.end && event.end.dateTime) === Date.parse(guard.end);
    }).length !== 1) throw new Error('Approved next-block Calendar start changed.');
  } else if (plan.patches.some(function(p) {return p.kind === 'planned_block';})) {
    throw new Error('Planned block requires the confirmed Calendar start.');
  }
  return {plan: plan, hash: hashTelegramConfirmationHex_(raw)};
}

function inspectDmsRecoveryPatch_(patch) {
  const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), patch.sheet);
  const range = sheet.getRange(patch.row, patch.col, 1, patch.after.length);
  if (range.getFormulas()[0].some(Boolean)) throw new Error('Recovery cannot overwrite formula ownership.');
  const values = canonicalTelegramConfirmationJson_(range.getValues()[0]);
  if (values === canonicalTelegramConfirmationJson_(patch.before.map(decodeDmsRecoveryCell_))) return 'before';
  if (values === canonicalTelegramConfirmationJson_(patch.after.map(decodeDmsRecoveryCell_))) return 'after';
  throw new Error('Recovery expected state differs; manual review required.');
}

function previewDmsEmergencyRecovery() {
  const loaded = loadDmsEmergencyRecoveryPlan_();
  if (loaded.plan.patches.some(function(p) { return inspectDmsRecoveryPatch_(p) !== 'before'; })) {
    throw new Error('Recovery already started; use its durable result.');
  }
  // Approval is pinned to the exact private payload, never to a mutable filename.
  PropertiesService.getScriptProperties().setProperty(DMS_EMERGENCY_RECOVERY.ACCEPTED, loaded.hash);
  console.log(JSON.stringify({planSha256: loaded.hash, patches: loaded.plan.patches.length, businessWrites: 0}));
}

function applyDmsEmergencyRecovery() {
  const mutex = LockService.getScriptLock();
  if (!mutex || !mutex.tryLock(10000)) throw new Error('Recovery lock unavailable.');
  try {
    const loaded = loadDmsEmergencyRecoveryPlan_(); const plan = loaded.plan;
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('DMS_P1_RELEASE_READY') ||
        !(Date.now() - Date.parse(props.getProperty('DMS_P1_DRAIN_STARTED_AT')) >= 420000)) {
      throw new Error('Recovery requires paused, drained writers.');
    }
    if (props.getProperty(DMS_EMERGENCY_RECOVERY.ACCEPTED) !== loaded.hash) throw new Error('Exact recovery preview required.');
    const previous = JSON.parse(props.getProperty(DMS_EMERGENCY_RECOVERY.RESULT) || 'null');
    if (previous && previous.planSha256 !== loaded.hash) throw new Error('A different recovery is already recorded.');
    const states = plan.patches.map(inspectDmsRecoveryPatch_);
    if (!previous && states.some(function(s) {return s !== 'before';})) throw new Error('Unexplained recovery effect.');
    if (previous && previous.status === 'committed') {
      if (states.some(function(s) {return s !== 'after';})) throw new Error('Committed recovery changed.');
      console.log(JSON.stringify(previous)); return previous;
    }
    // Persist intent before any business write. A restart resumes only ranges
    // proven exactly untouched or exactly equal to this immutable plan.
    const state = {planSha256: loaded.hash, status: 'started', startedAt: previous ? previous.startedAt : new Date().toISOString()};
    props.setProperty(DMS_EMERGENCY_RECOVERY.RESULT, JSON.stringify(state));
    plan.patches.forEach(function(patch) {
      if (inspectDmsRecoveryPatch_(patch) === 'after') return;
      getRequiredSheet_(SpreadsheetApp.getActive(), patch.sheet)
        .getRange(patch.row, patch.col, 1, patch.after.length).setValues([patch.after.map(decodeDmsRecoveryCell_)]);
      SpreadsheetApp.flush();
      if (inspectDmsRecoveryPatch_(patch) !== 'after') throw new Error('Recovery read-back differs.');
    });
    const financial = getDmsFinancialHealth_();
    if (!financial.ok || (financial.businessFindings || []).length) throw new Error('Recovered financial or semantic gate differs.');
    const audit = getRequiredSheet_(SpreadsheetApp.getActive(), 'Журнал действий бота');
    const auditId = 'AU-RECOVERY-' + loaded.hash.substring(0, 24);
    const existing = audit.getRange(1, 1, Math.max(1, audit.getLastRow()), 1).getValues()
      .filter(function(row) {return row[0] === auditId;});
    if (existing.length > 1) throw new Error('Recovery audit duplicated.');
    if (!existing.length) {
      audit.appendRow([auditId, new Date(), 'emergency_recovery', loaded.hash,
        'Approved private recovery: missing single payments, planned-block advance and missing unit price. Exact plan retained privately.',
        '', false, 'Owner recovery']);
      SpreadsheetApp.flush();
    }
    state.status = 'committed'; state.completedAt = new Date().toISOString(); state.patches = plan.patches.length;
    props.setProperty(DMS_EMERGENCY_RECOVERY.RESULT, JSON.stringify(state));
    console.log(JSON.stringify(state)); return state;
  } finally {mutex.releaseLock();}
}
