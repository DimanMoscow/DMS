// Versioned compensation plans retain entity IDs and history. All preconditions
// are checked before the first write under the shared operation mutex.
function sealDmsDomainUndo_(raw, auditId, action, entity) {
  if (!raw) return null;
  const steps = [];
  function capture(item) {
    if (!item || typeof item !== 'object') throw new Error('Invalid undo source.');
    if (item.type === 'compound') { (item.items || []).forEach(capture); return; }
    if (item.type === 'restore_range' || item.type === 'clear_range') {
      if (['Клиенты', 'Блоки', 'Оплаты', 'Очередь подтверждения'].indexOf(item.sheet) === -1) {
        throw new Error('Unsupported undo domain.');
      }
      const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), item.sheet);
      const values = item.type === 'restore_range' ? deserializeTelegramUndoValues_(item.values) :
        makeTelegramUndoValidationMatrix_(item.rows, item.columns);
      validateTelegramUndoRange_(sheet, item.row, item.column, values);
      if (values.length !== 1 || item.row < (item.sheet === 'Клиенты' ? 5 : 4)) throw new Error('Undo must identify one entity.');
      const id = String(sheet.getRange(item.row, 1).getValue() || '');
      if (!id) throw new Error('Undo entity identity missing.');
      const step = {kind: 'restore_fields', sheet: item.sheet, row: item.row, column: item.column,
        id: id, before: item.values || null,
        expected: serializeTelegramUndoValues_(sheet.getRange(item.row, item.column, 1, values[0].length).getValues())};
      if (item.type === 'clear_range') {
        if (item.column !== 1) throw new Error('Invalid entity compensation.');
        const domains = {'Клиенты': 'retire_client', 'Блоки': 'retire_block', 'Оплаты': 'void_payment'};
        step.kind = domains[item.sheet];
        if (!step.kind) throw new Error('Entity deletion is not supported.');
      } else if (item.column === 1 && String(values[0][0] || '') !== id) {
        throw new Error('Undo cannot replace an entity identity.');
      }
      steps.push(step); return;
    }
    if (item.type === 'move_calendar_event' || item.type === 'delete_calendar_event') {
      const event = Calendar.Events.get(item.calendarId, item.eventId);
      if (!event.etag) throw new Error('Undo Calendar version unavailable.');
      steps.push({kind: item.type, calendarId: item.calendarId, eventId: item.eventId,
        etag: event.etag, start: item.start, end: item.end, timeZone: item.timeZone});
      return;
    }
    throw new Error('Unsupported undo source.');
  }
  capture(raw);
  if (!steps.length) throw new Error('Empty compensation plan.');
  return {type: 'domain_compensation', version: 1, auditId: String(auditId), action: String(action),
    entity: String(entity || ''), expectedBusinessHash: getDmsConfirmedBusinessHash_(), steps: steps};
}

function assertDmsUndoDependencies_(plan) {
  const ss = SpreadsheetApp.getActive();
  function rows(name, first) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('Undo dependency sheet unavailable.');
    const last = sheet.getLastRow();
    return last < first ? [] : sheet.getRange(first, 1, last - first + 1, sheet.getLastColumn()).getValues()
      .map(function(values, index) { return {values: values, row: first + index}; });
  }
  function owned(name, row, kind) {
    return plan.steps.some(function(step) { return step.sheet === name && step.row === row && (!kind || step.kind === kind); });
  }
  plan.steps.forEach(function(step) {
    const retiringClient = step.kind === 'retire_client';
    const retiringBlock = step.kind === 'retire_block';
    if (retiringClient || retiringBlock) {
      [['Журнал тренировок', 4, retiringClient ? 2 : 3, null],
       ['Оплаты', 4, retiringClient ? 2 : 3, 'void_payment'],
       ['Очередь подтверждения', 4, retiringClient ? 8 : 10, 'restore_fields']].forEach(function(spec) {
        rows(spec[0], spec[1]).forEach(function(record) {
          if (String(record.values[spec[2]] || '') === step.id &&
              (!spec[3] || !owned(spec[0], record.row, spec[3]))) throw new Error('Undo has downstream references.');
        });
      });
      if (retiringClient) {
        rows('Блоки', 4).forEach(function(record) {
          if (String(record.values[1] || '') === step.id && !owned('Блоки', record.row, 'retire_block')) {
            throw new Error('Undo client has another block.');
          }
        });
        [['Доступ клиентов', 2], ['Замеры', 1], ['Приглашения Client Portal', 2]].forEach(function(spec) {
          rows(spec[0], 2).forEach(function(record) {
            if (String(record.values[spec[1]] || '') === step.id) throw new Error('Undo client has portal history.');
          });
        });
      } else rows('Клиенты', 5).forEach(function(record) {
        if (String(record.values[3] || '') === step.id && !owned('Клиенты', record.row)) {
          throw new Error('Undo block is still linked to a client.');
        }
      });
    }
    if (step.kind === 'restore_fields' && step.sheet === 'Очередь подтверждения') {
      rows('Журнал тренировок', 4).forEach(function(record) {
        if (String(record.values[18] || '') === step.id) throw new Error('Undo queue already has a Journal entry.');
      });
    }
  });
}

function validateDmsDomainUndo_(plan, auditValues) {
  if (!DMS_MUTATION_DEPTH || !plan || plan.type !== 'domain_compensation' || plan.version !== 1 ||
      !Array.isArray(plan.steps) || !plan.steps.length) throw new Error('Legacy or unsupported undo requires manual review.');
  if (auditValues && (plan.auditId !== String(auditValues[0]) || plan.action !== String(auditValues[2]) ||
      plan.entity !== String(auditValues[3] || ''))) throw new Error('Undo operation identity differs.');
  if (plan.expectedBusinessHash !== getDmsConfirmedBusinessHash_()) throw new Error('Undo state changed after original operation.');
  plan.steps.forEach(function(step) {
    if (step.calendarId) {
      const event = Calendar.Events.get(step.calendarId, step.eventId);
      if (event.etag !== step.etag) throw new Error('Undo Calendar state changed.');
      if (step.kind !== 'move_calendar_event' && step.kind !== 'delete_calendar_event') throw new Error('Unknown Calendar compensation.');
      if (step.kind === 'move_calendar_event' && (!step.timeZone ||
          !Number.isFinite(new Date(step.start).getTime()) || !Number.isFinite(new Date(step.end).getTime()))) {
        throw new Error('Invalid Calendar compensation times.');
      }
      return;
    }
    if (['restore_fields', 'retire_client', 'retire_block', 'void_payment'].indexOf(step.kind) === -1) throw new Error('Unknown compensation.');
    const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), step.sheet);
    const matches = sheet.getRange(1, 1, sheet.getLastRow(), 1).createTextFinder(step.id).matchEntireCell(true).findAll();
    if (matches.length !== 1 || matches[0].getRow() !== step.row) throw new Error('Undo row identity changed.');
    const actual = serializeTelegramUndoValues_(sheet.getRange(step.row, step.column, 1, step.expected[0].length).getValues());
    if (canonicalTelegramConfirmationJson_(actual) !== canonicalTelegramConfirmationJson_(step.expected)) throw new Error('Undo values changed.');
    if (step.kind === 'restore_fields') validateTelegramUndoRange_(sheet, step.row, step.column, deserializeTelegramUndoValues_(step.before));
  });
  assertDmsUndoDependencies_(plan);
}

function applyDmsDomainUndo_(plan) {
  // IDs are never removed, even if a service fault interrupts compensation.
  const priority = {void_payment: 0, move_calendar_event: 1, delete_calendar_event: 1,
    restore_fields: 2, retire_block: 3, retire_client: 4};
  plan.steps.slice().sort(function(a, b) { return priority[a.kind] - priority[b.kind]; }).forEach(function(step) {
    if (step.calendarId) {
      const resource = {start: {dateTime: step.start, timeZone: step.timeZone}, end: {dateTime: step.end, timeZone: step.timeZone}};
      if (step.kind === 'move_calendar_event') dmsCalendarPatch_(resource, step.calendarId, step.eventId, {sendUpdates: 'none'});
      else dmsCalendarRemove_(step.calendarId, step.eventId, {sendUpdates: 'none'});
      return;
    }
    const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), step.sheet);
    if (step.kind === 'restore_fields') {
      const values = deserializeTelegramUndoValues_(step.before);
      sheet.getRange(step.row, step.column, 1, values[0].length).setValues(values);
    } else if (step.kind === 'void_payment') {
      sheet.getRange(step.row, 8).setValue('Отменён');
      sheet.getRange(step.row, 10).setValue(appendTelegramAuditNote_(sheet.getRange(step.row, 10).getValue(), 'Компенсация ' + plan.auditId));
    } else if (step.kind === 'retire_block') sheet.getRange(step.row, 4).setValue('Закрыт');
    else if (step.kind === 'retire_client') {
      sheet.getRange(step.row, 3, 1, 2).setValues([['Архив', '']]);
    }
  });
  SpreadsheetApp.flush();
}

function restoreDmsImmediateQueueCompensation_(raw) {
  if (!DMS_MUTATION_DEPTH || !raw || raw.type !== 'restore_range' || raw.sheet !== 'Очередь подтверждения' || !raw.expected) {
    throw new Error('Immediate queue compensation context unavailable.');
  }
  const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), raw.sheet);
  const before = deserializeTelegramUndoValues_(raw.values);
  const actual = serializeTelegramUndoValues_(sheet.getRange(raw.row, raw.column, before.length, before[0].length).getValues());
  if (canonicalTelegramConfirmationJson_(actual) !== canonicalTelegramConfirmationJson_(raw.expected)) throw new Error('Queue changed during cancellation.');
  sheet.getRange(raw.row, raw.column, before.length, before[0].length).setValues(before);
}
