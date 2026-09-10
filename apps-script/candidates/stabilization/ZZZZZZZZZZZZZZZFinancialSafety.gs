// One aggregate per history source, filtered to real record IDs. Open-ended
// selectors discover growth (including gaps); QUERY operates on occupied rows.
// There are no per-client full-history SUMIFS and no fixed correctness horizon.
function ensureDmsSheetRowCapacity_(sheet, lastRow) {
  if (!Number.isInteger(lastRow) || lastRow < 1) throw new Error('Invalid sheet row capacity.');
  if (lastRow <= sheet.getMaxRows()) return;
  return withTelegramDocumentLock_(function() {
    const current = sheet.getMaxRows();
    if (lastRow > current) sheet.insertRowsAfter(current, Math.max(lastRow - current, Math.ceil(current / 4)));
  });
}

function getDmsFinancialFormulaPlan_() {
  function grouped(sheet, query, ids) {
    return 'IFNA(VLOOKUP(' + ids + ',QUERY(FILTER(\'' + sheet + '\'!C4:H,\'' + sheet +
      '\'!A4:A<>""),"' + query + '",0),2,FALSE),0)';
  }
  const completed = grouped('Журнал тренировок', "select Col2,count(Col2) where Col2 is not null and Col5='Проведена' group by Col2 label count(Col2) ''", 'A4:A');
  const paid = grouped('Оплаты', "select Col2,sum(Col5) where Col2 is not null and Col6='Подтверждён' group by Col2 label sum(Col5) ''", 'A4:A');
  const charges = grouped('Журнал тренировок', "select Col1,sum(Col6) where Col3='Разовая' and Col5='Проведена' group by Col1 label sum(Col6) ''", 'A5:A');
  const singlePaid = grouped('Оплаты', "select Col1,sum(Col5) where Col2 is null and Col6='Подтверждён' group by Col1 label sum(Col5) ''", 'A5:A');
  function clientLookup(index) {
    return 'IFNA(VLOOKUP(D5:D,FILTER(\'Блоки\'!A4:O,\'Блоки\'!A4:A<>""),' + index + ',FALSE),"")';
  }
  const client = {};
  [['F5', 9], ['G5', 10], ['H5', 11], ['I5', 14]].forEach(function(item) {
    client[item[0]] = '=ARRAYFORMULA(IF(A5:A="","",IF(D5:D="","",' + clientLookup(item[1]) + ')))';
  });
  client.J5 = '=ARRAYFORMULA(LET(charges,' + charges + ',paid,' + singlePaid + ',balance,charges-paid,' +
    'IF(A5:A="","",IF(D5:D<>"",' + clientLookup(15) +
    ',IF(REGEXMATCH(K5:K,"^Разов(ые|ая тренировка)[ —–-]"),IF(balance>0,balance,0),"")))))';
  const plan = {'Блоки': {
    I4: '=ARRAYFORMULA(IF(A4:A="","",' + completed + '))',
    J4: '=ARRAYFORMULA(IF(A4:A="","",IF(H4:H="","",H4:H-I4:I)))',
    N4: '=ARRAYFORMULA(IF(A4:A="","",' + paid + '))',
    O4: '=ARRAYFORMULA(IF(A4:A="","",IF(K4:K="","",K4:K-N4:N)))'
  }, 'Клиенты': client};
  Object.keys(plan).forEach(function(name) {
    Object.keys(plan[name]).forEach(function(address) {
      plan[name][address] = plan[name][address].replace(/"[^"]*"|,/g, function(token) { return token === ',' ? ';' : token; });
    });
  });
  return plan;
}

function installDmsFinancialAnchors_(sheet) {
  const plan = getDmsFinancialFormulaPlan_()[sheet.getName()];
  if (!plan) throw new Error('Unknown financial sheet.');
  Object.keys(plan).forEach(function(address) {
    const anchor = sheet.getRange(address);
    sheet.getRange(anchor.getRow(), anchor.getColumn(), sheet.getMaxRows() - anchor.getRow() + 1, 1).clearContent();
    anchor.setFormula(plan[address]);
  });
}

function getDmsClientFormatFormula_(row) {
  return '=IFERROR(INDEX(\'Блоки\'!$C$4:$C;MATCH(D' + row + ';\'Блоки\'!$A$4:$A;0));"")';
}

function getDmsClientFormatRepairs_(clients) {
  const last = clients.getLastRow(); const repairs = [];
  if (last < 5) return repairs;
  const normalize = function(value) { return value.replace(/;/g, ',').replace(/\s/g, ''); };
  clients.getRange(5, 5, last - 4, 1).getFormulas().forEach(function(values, index) {
    if (!values[0]) return;
    const row = index + 5; const next = getDmsClientFormatFormula_(row);
    const old = '=IFERROR(INDEX(\'Блоки\'!$C$4:$C$203;MATCH(D' + row + ';\'Блоки\'!$A$4:$A$203;0));"")';
    if ([normalize(old), normalize(next)].indexOf(normalize(values[0])) === -1) throw new Error('Unknown client format formula.');
    if (normalize(values[0]) !== normalize(next)) repairs.push({row: row, formula: next});
  });
  return repairs;
}

function computeDmsFinancialExpected_(clients, blocks, payments, journal) {
  const issues = []; const byBlock = {}; const byClient = {};
  const journalIds = {}; const paymentIds = {};
  function numeric(value, label) {
    if (value === '' || value === null || value === undefined) return 0;
    if (typeof value !== 'number' || !Number.isFinite(value)) { issues.push(label + ': invalid numeric value'); return 0; }
    return value;
  }
  function each(rows, callback) {
    rows.forEach(function(row, index) {
      if (!row[0]) {
        if (row.some(function(v) { return v !== '' && v !== null && v !== undefined && v !== false; })) issues.push('Record without ID');
        return;
      }
      callback(row, index);
    });
  }
  each(clients, function(row) {
    const id = String(row[0]); if (byClient[id]) issues.push('Duplicate client ID');
    byClient[id] = {row: row, singleCharges: 0, singlePaid: 0};
  });
  each(blocks, function(row) {
    const id = String(row[0]); if (byBlock[id]) issues.push('Duplicate block ID');
    byBlock[id] = {row: row, completed: 0, paid: 0};
    if (!byClient[String(row[1])]) issues.push('Block without client');
  });
  each(journal, function(row) {
    const recordId = String(row[0]);
    if (journalIds[recordId]) issues.push('Duplicate journal ID');
    journalIds[recordId] = true;
    const client = byClient[String(row[2])]; const block = byBlock[String(row[3])];
    if (!client) issues.push('Journal without client');
    if (row[3] && !block) issues.push('Journal without block');
    if (client && block && String(block.row[1]) !== String(row[2])) {
      issues.push('Journal block/client mismatch');
    }
    if (row[6] !== 'Проведена') return;
    if (block) block.completed++;
    if (client && row[4] === 'Разовая') client.singleCharges += numeric(row[7], 'Journal price');
  });
  each(payments, function(row) {
    const recordId = String(row[0]);
    if (paymentIds[recordId]) issues.push('Duplicate payment ID');
    paymentIds[recordId] = true;
    const client = byClient[String(row[2])]; const block = byBlock[String(row[3])];
    if (!client) issues.push('Payment without client');
    if (client && block && String(block.row[1]) !== String(row[2])) {
      issues.push('Payment block/client mismatch');
    }
    if (row[3] && !block) issues.push('Payment without block');
    if (row[7] !== 'Подтверждён') return;
    const amount = numeric(row[6], 'Payment amount');
    if (row[3]) { if (block) block.paid += amount; }
    else if (client) client.singlePaid += amount;
  });
  const blockResults = {}; const clientResults = {};
  Object.keys(byBlock).forEach(function(id) {
    const item = byBlock[id];
    blockResults[id] = {9: item.completed, 10: item.row[7] === '' ? '' : numeric(item.row[7], 'Block count') - item.completed,
      14: item.paid, 15: item.row[10] === '' ? '' : numeric(item.row[10], 'Block price') - item.paid};
  });
  Object.keys(byClient).forEach(function(id) {
    const item = byClient[id]; const blockId = String(item.row[3] || ''); const block = byBlock[blockId];
    if (blockId && (!block || String(block.row[1]) !== id)) issues.push('Invalid active block link');
    const values = {6: '', 7: '', 8: '', 9: '', 10: ''};
    if (block) {
      values[6] = blockResults[blockId][9]; values[7] = blockResults[blockId][10];
      values[8] = block.row[10]; values[9] = blockResults[blockId][14]; values[10] = blockResults[blockId][15];
    } else if (!blockId && getSingleTrainingPrice_(item.row[10])) values[10] = Math.max(0, item.singleCharges - item.singlePaid);
    clientResults[id] = values;
  });
  return {blocks: blockResults, clients: clientResults, issues: issues};
}

function buildDmsSemanticReconciliationHealth_(financial) {
  const classes = {
    duplicateId: 0,
    missingReference: 0,
    ownershipMismatch: 0,
    invalidValue: 0,
    formulaIntegrity: 0,
    numericMismatch: (financial.numericMismatches || financial.mismatches || []).length,
    other: (financial.businessFindings || []).length
  };
  (financial.issues || []).forEach(function(issue) {
    const value = String(issue || '');
    if (/^Duplicate /.test(value)) classes.duplicateId++;
    else if (/ without /.test(value)) classes.missingReference++;
    else if (/mismatch$/.test(value) || value === 'Invalid active block link') {
      classes.ownershipMismatch++;
    } else if (/invalid numeric value$/.test(value) || value === 'Record without ID') {
      classes.invalidValue++;
    } else if (/formula|anchor/i.test(value)) classes.formulaIntegrity++;
    else classes.other++;
  });
  const issueCount = Object.keys(classes).reduce(function(total, name) {
    return total + classes[name];
  }, 0);
  return {
    state: issueCount ? 'failed' : 'healthy',
    ok: issueCount === 0,
    issueCount: issueCount,
    issueClasses: classes
  };
}

function computeDmsBusinessSemanticFindings_(clients, blocks, payments, journal, queue) {
  const findings = [];
  const add = function(kind, ref) { findings.push({kind: kind, ref: String(ref)}); };
  const byBlock = {}; const singleCharges = {}; const singlePaid = {}; const byQueue = {};
  blocks.forEach(function(row) {
    if (!row[0]) return;
    byBlock[String(row[0])] = {row: row, counted: 0, paid: 0};
    if (!Number.isSafeInteger(row[7]) || row[7] <= 0 ||
        !Number.isFinite(row[10]) || row[10] <= 0 || !Number.isFinite(row[11]) || row[11] <= 0) {
      add('block_financial_fields', row[0]);
    }
  });
  journal.forEach(function(row) {
    if (!row[0] || row[6] !== 'Проведена') return;
    if (row[18]) {
      const key = String(row[18]);
      if (!byQueue[key]) byQueue[key] = [];
      byQueue[key].push(row);
    }
    if (byBlock[String(row[3])]) byBlock[String(row[3])].counted++;
    if (!row[3] && row[4] === 'Разовая' && row[5] === 'Фактически проведена') {
      singleCharges[String(row[2])] = (singleCharges[String(row[2])] || 0) + Number(row[7] || 0);
    }
  });
  payments.forEach(function(row) {
    if (!row[0] || row[7] !== 'Подтверждён') return;
    if (byBlock[String(row[3])]) byBlock[String(row[3])].paid += Number(row[6] || 0);
    else if (!row[3]) singlePaid[String(row[2])] = (singlePaid[String(row[2])] || 0) + Number(row[6] || 0);
  });
  Object.keys(byBlock).forEach(function(id) {
    const item = byBlock[id];
    if (item.counted > item.row[7]) add('block_overconsumed', id);
    if (item.paid > item.row[10]) add('block_overpaid_requires_review', id);
  });
  clients.forEach(function(row) {
    if (!row[0]) return;
    const block = byBlock[String(row[3])];
    if (row[3] && (!block || block.row[3] === 'Закрыт')) add('invalid_active_block', row[0]);
    if ((singleCharges[String(row[0])] || 0) > (singlePaid[String(row[0])] || 0)) add('single_payment_gap', row[0]);
  });
  queue.forEach(function(row) {
    if (!row[0] || row[13] !== 'Обработано') return;
    const records = byQueue[String(row[0])] || [];
    const charged = ['Проведена', 'Отмена со списанием'].indexOf(row[12]) !== -1;
    const free = ['Отмена без списания', 'Не учитывать'].indexOf(row[12]) !== -1;
    if (charged && records.length !== 1 || free && records.length !== 0) add('queue_accounting_effect', row[0]);
    if (records.some(function(record) {return String(record[2]) !== String(row[8]) ||
        row[10] && String(record[3]) !== String(row[10]);})) add('queue_journal_ownership', row[0]);
  });
  return findings;
}

function getDmsFinancialHealth_() {
  const ss = SpreadsheetApp.getActive();
  function read(name, first, width) {
    const sheet = getRequiredSheet_(ss, name);
    return sheet.getLastRow() < first ? [] : sheet.getRange(first, 1, sheet.getLastRow() - first + 1, width).getValues();
  }
  const clients = read('Клиенты', 5, 14); const blocks = read('Блоки', 4, 17);
  const payments = read('Оплаты', 4, 10); const journal = read('Журнал тренировок', 4, 19);
  const expected = computeDmsFinancialExpected_(clients, blocks, payments, journal);
  const businessFindings = computeDmsBusinessSemanticFindings_(clients, blocks, payments,
    journal, read('Очередь подтверждения', 4, 17));
  const issues = expected.issues.slice(); const mismatches = [];
  try {
    if (getDmsClientFormatRepairs_(getRequiredSheet_(ss, 'Клиенты')).length) issues.push('Client format lookup has a fixed horizon');
  } catch (error) { issues.push('Unknown client format formula'); }
  [[clients, expected.clients, 'Клиенты', 5], [blocks, expected.blocks, 'Блоки', 4]].forEach(function(spec) {
    spec[0].forEach(function(row, index) {
      if (!row[0] || !spec[1][String(row[0])]) return;
      const values = spec[1][String(row[0])];
      Object.keys(values).forEach(function(column) {
        const actual = row[Number(column) - 1]; const wanted = values[column];
        if (wanted === '' ? actual !== '' : typeof actual !== 'number' || Math.abs(actual - wanted) > 0.000001) {
          mismatches.push({sheet: spec[2], row: index + spec[3], column: Number(column)});
        }
      });
    });
  });
  const plan = getDmsFinancialFormulaPlan_();
  function normalize(value) {return String(value).replace(/;/g, ',').replace(/\s/g, '');}
  Object.keys(plan).forEach(function(name) {
    const sheet = getRequiredSheet_(ss, name);
    Object.keys(plan[name]).forEach(function(address) {
      const anchor = sheet.getRange(address);
      if (normalize(anchor.getFormula()) !== normalize(plan[name][address])) issues.push('Financial anchor differs: ' + name + '!' + address);
      const last = Math.max(anchor.getRow(), sheet.getLastRow());
      const formulas = sheet.getRange(anchor.getRow(), anchor.getColumn(), last - anchor.getRow() + 1, 1).getFormulas();
      if (formulas.slice(1).some(function(row) {return row[0] !== '';})) issues.push('Extra financial anchor: ' + name + '!' + address);
    });
  });
  return {ok: issues.length === 0 && mismatches.length === 0, issues: issues, mismatches: mismatches,
    businessFindings: businessFindings,
    summary: 'financial issues=' + issues.length + '; numeric mismatches=' + mismatches.length};
}
