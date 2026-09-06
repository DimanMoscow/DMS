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
    if (row[6] !== 'Проведена') return;
    const client = byClient[String(row[2])]; const block = byBlock[String(row[3])];
    if (!client) issues.push('Journal without client');
    if (row[3] && !block) issues.push('Journal without block');
    if (block) block.completed++;
    if (client && row[4] === 'Разовая') client.singleCharges += numeric(row[7], 'Journal price');
  });
  each(payments, function(row) {
    if (row[7] !== 'Подтверждён') return;
    const client = byClient[String(row[2])]; const block = byBlock[String(row[3])];
    const amount = numeric(row[6], 'Payment amount');
    if (!client) issues.push('Payment without client');
    if (row[3]) { if (!block) issues.push('Payment without block'); else block.paid += amount; }
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

function getDmsFinancialHealth_() {
  const ss = SpreadsheetApp.getActive();
  function read(name, first, width) {
    const sheet = getRequiredSheet_(ss, name);
    return sheet.getLastRow() < first ? [] : sheet.getRange(first, 1, sheet.getLastRow() - first + 1, width).getValues();
  }
  const clients = read('Клиенты', 5, 14); const blocks = read('Блоки', 4, 17);
  const expected = computeDmsFinancialExpected_(clients, blocks, read('Оплаты', 4, 10), read('Журнал тренировок', 4, 19));
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
    summary: 'financial issues=' + issues.length + '; numeric mismatches=' + mismatches.length};
}
