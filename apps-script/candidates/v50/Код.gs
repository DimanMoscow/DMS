const DMS = {
  CLIENTS: 'Клиенты',
  BLOCKS: 'Блоки',
  LOG: 'Журнал тренировок',

  CLIENT_FIRST_ROW: 5,
  BLOCK_FIRST_ROW: 4,
  LOG_FIRST_ROW: 4,

  CLIENT_ACTION_COL: 12, // L
  BLOCK_ACTION_COL: 17,  // Q
  LOG_ACTION_COL: 12     // L
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('DMS Fitness')
    .addItem('+ Тренировка для выбранного клиента', 'addTrainingFromSelectedRow')
    .addItem('Закрыть выбранный блок', 'closeBlockFromSelectedRow')
    .addItem('Отменить выбранную запись', 'cancelTrainingFromSelectedRow')
    .addSeparator()
    .addItem('Предпросмотр выбранного дня', 'previewSelectedQueueDay')
    .addItem('Подтвердить выбранный день', 'processSelectedQueueDay')
    .addItem('Синхронизировать календарь сейчас', 'syncCalendarToQueue')
    .addSeparator()
    .addItem('Проверить и настроить таблицу', 'setupDmsFitness')
    .addToUi();
}

function setupDmsFitness() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('Europe/Moscow');

  const clients = getRequiredSheet_(ss, DMS.CLIENTS);
  const blocks = getRequiredSheet_(ss, DMS.BLOCKS);
  const log = getRequiredSheet_(ss, DMS.LOG);

  clients.getRange('L4').setValue('+ Тренировка');
  clients.getRange('L5:L203').insertCheckboxes().setValue(false);

  blocks.getRange('Q3').setValue('Закрыть блок');
  blocks.getRange('Q4:Q203').insertCheckboxes().setValue(false);

  log.getRange('L3').setValue('Отменить запись');
  log.getRange('L4:L503').insertCheckboxes().setValue(false);

  repairBlockFormulas_(blocks);
  

  ss.toast(
    'Часовой пояс Москвы установлен. Действия и формулы настроены.',
    'DMS Fitness',
    7
  );
}

function onEdit(e) {
  if (!e || e.value !== 'TRUE') return;

  const range = e.range;
  const sheet = range.getSheet();
  const row = range.getRow();
  const col = range.getColumn();

  try {
    if (
      sheet.getName() === DMS.CLIENTS &&
      col === DMS.CLIENT_ACTION_COL &&
      row >= DMS.CLIENT_FIRST_ROW
    ) {
      addTraining_(row);
    } else if (
      sheet.getName() === DMS.BLOCKS &&
      col === DMS.BLOCK_ACTION_COL &&
      row >= DMS.BLOCK_FIRST_ROW
    ) {
      closeBlock_(row);
    } else if (
      sheet.getName() === DMS.LOG &&
      col === DMS.LOG_ACTION_COL &&
      row >= DMS.LOG_FIRST_ROW
    ) {
      cancelTraining_(row);
    }
  } catch (error) {
    SpreadsheetApp.getActive().toast(
      error.message,
      'Действие не выполнено',
      10
    );
  } finally {
    range.setValue(false);
  }
}

function addTrainingFromSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();

  if (sheet.getName() !== DMS.CLIENTS) {
    throw new Error('Сначала выбери строку клиента на листе «Клиенты».');
  }

  addTraining_(sheet.getActiveRange().getRow());
}

function closeBlockFromSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();

  if (sheet.getName() !== DMS.BLOCKS) {
    throw new Error('Сначала выбери строку блока на листе «Блоки».');
  }

  closeBlock_(sheet.getActiveRange().getRow());
}

function cancelTrainingFromSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();

  if (sheet.getName() !== DMS.LOG) {
    throw new Error(
      'Сначала выбери запись на листе «Журнал тренировок».'
    );
  }

  cancelTraining_(sheet.getActiveRange().getRow());
}

function addTraining_(clientRow) {
  const lock = LockService.getDocumentLock();

  if (!lock.tryLock(5000)) {
    throw new Error('Предыдущее действие ещё выполняется. Повтори через несколько секунд.');
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const clients = getRequiredSheet_(ss, DMS.CLIENTS);
    const blocks = getRequiredSheet_(ss, DMS.BLOCKS);
    const log = getRequiredSheet_(ss, DMS.LOG);

    const client = clients.getRange(clientRow, 1, 1, 12).getValues()[0];

    const clientId = client[0];
    const clientName = client[1];
    const clientStatus = client[2];
    const blockId = client[3];
    const conditions = client[10];

    if (!clientId || !clientName) {
      throw new Error('В выбранной строке нет клиента.');
    }

    if (clientStatus !== 'Активен') {
      throw new Error(
        `У клиента «${clientName}» статус «${clientStatus || 'не указан'}».`
      );
    }

    const singlePrice = getSingleTrainingPrice_(conditions);

    if (!blockId && singlePrice) {
      writeTrainingLogRow_(log, {
        clientId: clientId,
        blockId: '',
        format: 'Разовая',
        trainingPrice: singlePrice
      });

      SpreadsheetApp.flush();

      ss.toast(
        `Записана разовая тренировка: ${clientName}. Стоимость: ${singlePrice.toLocaleString('ru-RU')} ₽.`,
        'DMS Fitness',
        8
      );
      return;
    }

    if (!blockId) {
      throw new Error(`У клиента «${clientName}» не указан активный блок.`);
    }

    const blockRow = findRowByValue_(
      blocks,
      1,
      blockId,
      DMS.BLOCK_FIRST_ROW
    );

    if (!blockRow) {
      throw new Error(`Блок ${blockId} не найден.`);
    }

    const block = blocks.getRange(blockRow, 1, 1, 17).getValues()[0];

    const format = block[2];
    const blockStatus = block[3];
    const totalTrainings = Number(block[7]) || 0;
    const trainingPrice = Number(block[11]) || 0;

    if (blockStatus !== 'Активен') {
      throw new Error(`Блок ${blockId} имеет статус «${blockStatus}».`);
    }

    const completed = countCompletedTrainings_(log, blockId);

    if (completed >= totalTrainings) {
      throw new Error(
        `В блоке ${blockId} закончились тренировки: ${completed} из ${totalTrainings}.`
      );
    }

    writeTrainingLogRow_(log, {
      clientId: clientId,
      blockId: blockId,
      format: format,
      trainingPrice: trainingPrice
    });

    SpreadsheetApp.flush();

    const remaining = totalTrainings - completed - 1;

    ss.toast(
      `Записана тренировка: ${clientName}. Осталось: ${remaining}.`,
      'DMS Fitness',
      8
    );
  } finally {
    lock.releaseLock();
  }
}

function getSingleTrainingPrice_(conditions) {
  const text = String(conditions || '').trim();

  if (!/^Разов(?:ые|ая\s+тренировка)(?:\s|—|–|-)/i.test(text)) return null;

  const match = text.match(/Разов(?:ые|ая\s+тренировка)\s*[—–-]\s*([\d\s\u00A0]+)\s*₽/i);
  const price = match ? Number(match[1].replace(/\D/g, '')) : 0;

  return price > 0 ? price : null;
}

function writeTrainingLogRow_(log, data) {
  const newRow = findFirstEmptyRow_(log, 1, DMS.LOG_FIRST_ROW);
  const recordId = makeNextId_(log, 1, 'TR');
  const template = log.getRange(DMS.LOG_FIRST_ROW, 1, 1, 12);
  const target = log.getRange(newRow, 1, 1, 12);

  template.copyTo(
    target,
    SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
    false
  );

  template.copyTo(
    target,
    SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION,
    false
  );

  target.setValues([[
    recordId,
    new Date(),
    data.clientId,
    data.blockId,
    data.format,
    'Фактически проведена',
    'Проведена',
    data.trainingPrice,
    'Кнопка',
    '',
    '',
    false
  ]]);

  log.getRange(newRow, DMS.LOG_ACTION_COL).insertCheckboxes().setValue(false);
}

function closeBlock_(blockRow) {
  const lock = LockService.getDocumentLock();

  if (!lock.tryLock(5000)) {
    throw new Error('Предыдущее действие ещё выполняется.');
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const blocks = getRequiredSheet_(ss, DMS.BLOCKS);
    const clients = getRequiredSheet_(ss, DMS.CLIENTS);
    const log = getRequiredSheet_(ss, DMS.LOG);

    const block = blocks.getRange(blockRow, 1, 1, 17).getValues()[0];

    const blockId = block[0];
    const clientId = block[1];
    const currentStatus = block[3];
    let reason = block[6];
    const totalTrainings = Number(block[7]) || 0;

    if (!blockId) {
      throw new Error('В выбранной строке нет блока.');
    }

    if (currentStatus === 'Закрыт') {
      throw new Error(`Блок ${blockId} уже закрыт.`);
    }

    const completed = countCompletedTrainings_(log, blockId);
    const remaining = Math.max(totalTrainings - completed, 0);

    if (!reason && remaining === 0) {
      reason = 'Завершён';
    }

    if (!reason && remaining > 0) {
      throw new Error(
        `В блоке осталось ${remaining} тренировок. Сначала укажи причину закрытия в столбце G.`
      );
    }

    blocks.getRange(blockRow, 4).setValue('Закрыт');
    blocks.getRange(blockRow, 6).setValue(new Date());
    blocks.getRange(blockRow, 7).setValue(reason);

    const clientRow = findRowByValue_(
      clients,
      1,
      clientId,
      DMS.CLIENT_FIRST_ROW
    );

    if (clientRow) {
      const activeBlock = clients.getRange(clientRow, 4).getValue();

      if (activeBlock === blockId) {
        clients.getRange(clientRow, 4).clearContent();
      }
    }

    ss.toast(
      `Блок ${blockId} закрыт. Причина: ${reason}.`,
      'DMS Fitness',
      8
    );
  } finally {
    lock.releaseLock();
  }
}

function cancelTraining_(logRow) {
  const lock = LockService.getDocumentLock();

  if (!lock.tryLock(5000)) {
    throw new Error('Предыдущее действие ещё выполняется.');
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const log = getRequiredSheet_(ss, DMS.LOG);

    const record = log.getRange(logRow, 1, 1, 12).getValues()[0];

    const recordId = record[0];
    const status = record[6];
    const reason = record[10];

    if (!recordId) {
      throw new Error('В выбранной строке нет записи.');
    }

    if (status === 'Отменена') {
      throw new Error(`Запись ${recordId} уже отменена.`);
    }

    if (status !== 'Проведена') {
      throw new Error(
        `Запись ${recordId} нельзя отменить: текущий статус «${status}».`
      );
    }

    if (!reason) {
      throw new Error(
        'Сначала укажи причину отмены в столбце K, затем повтори действие.'
      );
    }

    log.getRange(logRow, 7).setValue('Отменена');
    log.getRange(logRow, 10).setValue(new Date());

    ss.toast(
      `Запись ${recordId} отменена. Тренировка возвращена в остаток.`,
      'DMS Fitness',
      8
    );
  } finally {
    lock.releaseLock();
  }
}

function countCompletedTrainings_(log, blockId) {
  const lastRow = log.getLastRow();

  if (lastRow < DMS.LOG_FIRST_ROW) return 0;

  const rows = log
    .getRange(
      DMS.LOG_FIRST_ROW,
      4,
      lastRow - DMS.LOG_FIRST_ROW + 1,
      4
    )
    .getValues();

  return rows.filter(row =>
    row[0] === blockId && row[3] === 'Проведена'
  ).length;
}

function findRowByValue_(sheet, column, value, firstRow) {
  const lastRow = sheet.getLastRow();

  if (lastRow < firstRow) return null;

  const values = sheet
    .getRange(firstRow, column, lastRow - firstRow + 1, 1)
    .getValues()
    .flat();

  const index = values.findIndex(item => String(item) === String(value));

  return index === -1 ? null : firstRow + index;
}

function makeNextId_(sheet, column, prefix) {
  const lastRow = sheet.getLastRow();

  if (lastRow < DMS.LOG_FIRST_ROW) {
    return `${prefix}-001`;
  }

  const values = sheet
    .getRange(
      DMS.LOG_FIRST_ROW,
      column,
      lastRow - DMS.LOG_FIRST_ROW + 1,
      1
    )
    .getValues()
    .flat();

  const maxNumber = values.reduce((max, value) => {
    const match = String(value).match(
      new RegExp(`^${prefix}-(\\d+)$`)
    );

    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `${prefix}-${String(maxNumber + 1).padStart(3, '0')}`;
}

function repairBlockFormulas_(blocks) {
  const rows = 200;

  for (let offset = 0; offset < rows; offset++) {
    const row = DMS.BLOCK_FIRST_ROW + offset;

    blocks.getRange(row, 9).setFormula(
      `=IF(A${row}="";"";COUNTIFS('Журнал тренировок'!$D$4:$D$503;A${row};'Журнал тренировок'!$G$4:$G$503;"Проведена"))`
    );

    blocks.getRange(row, 10).setFormula(
      `=IF(H${row}="";"";H${row}-I${row})`
    );

    blocks.getRange(row, 14).setFormula(
      `=IF(A${row}="";"";SUMIFS('Оплаты'!$G$4:$G$503;'Оплаты'!$D$4:$D$503;A${row};'Оплаты'!$H$4:$H$503;"Подтверждён"))`
    );

    blocks.getRange(row, 15).setFormula(
      `=IF(K${row}="";"";K${row}-N${row})`
    );
  }
}

function getRequiredSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    throw new Error(`Не найден лист «${name}».`);
  }

  return sheet;
}

function findFirstEmptyRow_(sheet, column, firstRow) {
  const lastRow = Math.max(sheet.getLastRow(), firstRow);
  const values = sheet
    .getRange(firstRow, column, lastRow - firstRow + 1, 1)
    .getValues()
    .flat();

  const emptyIndex = values.findIndex(value => value === '');

  return emptyIndex === -1
    ? lastRow + 1
    : firstRow + emptyIndex;
}

function repairClientDebtFormulas_(clients) {
  const rows = 199;

  for (let offset = 0; offset < rows; offset++) {
    const row = DMS.CLIENT_FIRST_ROW + offset;

    clients.getRange(row, 10).setFormula(
      `=IF(A${row}="","",IF(D${row}<>"",IFERROR(VLOOKUP(D${row},'Блоки'!$A$4:$O$203,15,FALSE),""),IF(LEFT(K${row},7)="Разовые",MAX(0,SUMIFS('Журнал тренировок'!$H$4:$H$503,'Журнал тренировок'!$C$4:$C$503,A${row},'Журнал тренировок'!$G$4:$G$503,"Проведена",'Журнал тренировок'!$E$4:$E$503,"Разовая")-SUMIFS('Оплаты'!$G$4:$G$503,'Оплаты'!$C$4:$C$503,A${row},'Оплаты'!$D$4:$D$503,"",'Оплаты'!$H$4:$H$503,"Подтверждён")),"")))`
    );
  }
}