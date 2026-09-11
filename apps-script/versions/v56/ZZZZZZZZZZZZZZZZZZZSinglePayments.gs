// Automatic settlement applies only to newly confirmed conducted singles.
// Historical gaps require an explicit recovery plan, never an interactive retry.
function getDmsSingleSettlementContext_(ss) {
  const read = function(name, width) {
    const sheet = getRequiredSheet_(ss, name);
    return sheet.getLastRow() < 4 ? [] : sheet.getRange(4, 1, sheet.getLastRow() - 3, width).getValues();
  };
  const payments = read('Оплаты', 10);
  const journal = read('Журнал тренировок', 19);
  const credit = {};
  payments.forEach(function(row) {
    if (row[0] && !row[3] && row[7] === 'Подтверждён') {
      if (!Number.isFinite(row[6])) throw new Error('Invalid single payment amount.');
      credit[String(row[2])] = (credit[String(row[2])] || 0) + row[6];
    }
  });
  journal.forEach(function(row) {
    if (row[0] && !row[3] && row[4] === 'Разовая' && row[6] === 'Проведена') {
      if (!Number.isFinite(row[7]) || row[7] <= 0) throw new Error('Invalid single training price.');
      credit[String(row[2])] = (credit[String(row[2])] || 0) - row[7];
    }
  });
  return {payments: payments, journal: journal, credit: credit};
}

function planDmsSingleSettlement_(context, values, price) {
  const queueId = String(values[0]); const clientId = String(values[8]);
  const marker = '[single:' + queueId + ']';
  const matches = context.payments.filter(function(row) {return String(row[9] || '').indexOf(marker) !== -1;});
  if (matches.length || !Number.isFinite(price) || price <= 0) {
    return {error: 'Оплата разовой требует сверки до повторного учёта.'};
  }
  const credit = Math.max(0, context.credit[clientId] || 0);
  if (credit > 0 && credit < price) {
    return {error: 'Частичная предоплата разовой требует сверки.'};
  }
  const amount = credit >= price ? 0 : price;
  context.credit[clientId] = (context.credit[clientId] || 0) + amount - price;
  return {queueId: queueId, clientId: clientId, date: values[5], amount: amount,
    marker: amount ? marker : '[single-credit:' + queueId + ']'};
}

function writeDmsSingleSettlement_(ss, plan) {
  if (!DMS_MUTATION_DEPTH) throw new Error('Shared mutation lock required.');
  if (!plan.amount) return null;
  const sheet = getRequiredSheet_(ss, 'Оплаты');
  const row = findTelegramEmptyPaymentRow_(sheet);
  const id = makeNextTelegramPaymentId_(sheet);
  ensureDmsSheetRowCapacity_(sheet, row);
  const values = [id, plan.date, plan.clientId, '', 'Оплата', 'Перевод', plan.amount,
    'Подтверждён', new Date(), 'Проведённая разовая: автоматическая оплата ' + plan.marker];
  sheet.getRange(row, 1, 1, 10).setValues([values]);
  return id;
}

function assertDmsExistingSingleSettlement_(context, recordId) {
  const rows = context.journal.filter(function(row) {return String(row[0]) === String(recordId);});
  if (rows.length !== 1) throw new Error('Existing journal identity ambiguous.');
  const row = rows[0];
  const marker = String(row[9] || '').match(/\[single:Q-[A-Za-z0-9_-]+\]/);
  if (!marker) return;
  const matches = context.payments.filter(function(payment) {
    return String(payment[9] || '').indexOf(marker[0]) !== -1;
  });
  if (matches.length !== 1 || matches[0][7] !== 'Подтверждён' ||
      String(matches[0][2]) !== String(row[2]) || matches[0][3] || matches[0][6] !== row[7]) {
    throw new Error('Single settlement outcome requires manual review; no blind replay.');
  }
}
