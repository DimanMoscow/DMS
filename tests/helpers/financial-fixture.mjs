export function financialFixture(scale = 1, boundary = false) {
  const data = {'Клиенты': [[], [], [], ['ID']], 'Блоки': [[], [], ['ID']],
    'Оплаты': [[], [], ['ID']], 'Журнал тренировок': [[], [], ['ID']]};
  const expected = {clients: {}, blocks: {}};
  const clients = boundary ? 5 : 18 * scale; const blocks = boundary ? 4 : 15 * scale;
  const clientRow = i => boundary ? [202, 203, 204, 705, 5][i] : i + 5;
  const blockRow = i => boundary ? [202, 203, 204, 705][i] : i + 4;
  const clientIds = Array.from({length: clients}, (_, i) => 'CL-F' + i);
  const blockIds = Array.from({length: blocks}, (_, i) => 'BL-F' + i);
  for (let i = 0; i < clients; i++) {
    const isBlock = i < blocks;
    const row = Array(14).fill('');
    Object.assign(row, {0: clientIds[i], 1: 'Synthetic financial ' + i, 2: 'Активен',
      3: isBlock ? blockIds[i] : '', 4: isBlock ? 'Блок 10' : 'Разовая',
      10: isBlock ? '' : 'Разовая тренировка — 3500 ₽'});
    data['Клиенты'][clientRow(i) - 1] = row;
    expected.clients[clientIds[i]] = {row: clientRow(i), blockIndex: isBlock ? i : null, charges: 0, paid: 0};
  }
  for (let i = 0; i < blocks; i++) {
    const row = Array(17).fill('');
    Object.assign(row, {0: blockIds[i], 1: clientIds[i], 2: 'Блок 10', 3: 'Активен', 7: 10, 10: 30000, 11: 3000});
    data['Блоки'][blockRow(i) - 1] = row;
    expected.blocks[blockIds[i]] = {row: blockRow(i), completed: 0, paid: 0};
  }
  for (let i = 0; i < (boundary ? 5 : 115 * scale); i++) {
    const owner = i % clients; const charged = boundary || i % 7 !== 0;
    const physical = boundary ? [502, 503, 504, 2504, 4][i] : i + 4;
    const row = Array(19).fill('');
    Object.assign(row, {0: 'TR-F' + i, 2: clientIds[owner], 3: owner < blocks ? blockIds[owner] : '',
      4: owner < blocks ? 'Блок 10' : 'Разовая', 6: charged ? 'Проведена' : 'Отменена', 7: owner < blocks ? 3000 : 3500});
    data['Журнал тренировок'][physical - 1] = row;
    if (charged) {
      if (owner < blocks) expected.blocks[blockIds[owner]].completed++;
      else expected.clients[clientIds[owner]].charges += 3500;
    }
  }
  for (let i = 0; i < (boundary ? 5 : 21 * scale); i++) {
    const owner = i % clients; const confirmed = boundary || i % 5 !== 0; const amount = 100 + i;
    const physical = boundary ? [502, 503, 504, 2504, 4][i] : i + 4;
    const row = ['PAY-F' + i, '', clientIds[owner], owner < blocks ? blockIds[owner] : '',
      'Оплата', 'Перевод', amount, confirmed ? 'Подтверждён' : 'Отменён', '', ''];
    data['Оплаты'][physical - 1] = row;
    if (confirmed) {
      if (owner < blocks) expected.blocks[blockIds[owner]].paid += amount;
      else expected.clients[clientIds[owner]].paid += amount;
    }
  }
  for (const value of Object.values(expected.blocks)) value.columns = {9: value.completed, 10: 10 - value.completed, 14: value.paid, 15: 30000 - value.paid};
  for (const value of Object.values(expected.clients)) {
    const block = value.blockIndex === null ? null : expected.blocks[blockIds[value.blockIndex]];
    value.columns = block ? {6: block.completed, 7: 10 - block.completed, 8: 30000, 9: block.paid, 10: 30000 - block.paid}
      : {6: '', 7: '', 8: '', 9: '', 10: Math.max(0, value.charges - value.paid)};
  }
  for (const name of Object.keys(data)) data[name] = Array.from(data[name], row => row || []);
  return {data, expected};
}

export function financialMismatches(data, expected) {
  const errors = [];
  for (const [name, targets] of [['Клиенты', expected.clients], ['Блоки', expected.blocks]]) {
    for (const [id, item] of Object.entries(targets)) for (const [column, value] of Object.entries(item.columns)) {
      const actual = data[name]?.[item.row - 1]?.[Number(column) - 1] ?? '';
      if (actual !== value) errors.push({id, sheet: name, row: item.row, column: Number(column), expected: value, actual});
    }
  }
  return errors;
}
