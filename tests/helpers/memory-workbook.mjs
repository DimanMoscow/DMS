// Service-boundary emulator. State survives VM executions; no business function
// or ledger implementation is replaced. Writes can fail before or after durability.
export function memoryWorkbook(initial = {}) {
  const sheets = new Map();
  const writes = [];
  const hooks = {before: null, after: null};
  function mutate(event, fn) {
    hooks.before?.(event);
    fn(); writes.push(event);
    hooks.after?.(event);
  }
  function makeSheet(name, initialRows = []) {
    const rows = initialRows.map(row => [...row]);
    const formats = new Map();
    let maxRows = Math.max(1000, rows.length);
    let maxColumns = 30;
    const sheet = {
      rows, getName: () => name, getLastRow: () => {
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i]?.some(x => x !== '' && x != null)) return i + 1;
        return 0;
      },
      getLastColumn: () => Math.max(1, ...Array.from(rows, r => r?.length || 0)),
      getMaxRows: () => maxRows, getMaxColumns: () => maxColumns,
      insertRowsAfter: (_, count) => {maxRows += count;},
      insertColumnsAfter: (_, count) => {maxColumns += count;},
      setFrozenRows: () => sheet,
      appendRow: values => {
        const row = sheet.getLastRow() + 1;
        if (row > maxRows) maxRows = row;
        return sheet.getRange(row, 1, 1, values.length).setValues([values]);
      },
      getDataRange: () => sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), sheet.getLastColumn()),
      getRange(row, col, height = 1, width = 1) {
        if (typeof row === 'string') {
          const m = row.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
          if (!m) throw new Error(`Unsupported range ${row}`);
          const column = x => [...x].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
          row = Number(m[2]); col = column(m[1]);
          height = m[4] ? Number(m[4]) - row + 1 : 1;
          width = m[3] ? column(m[3]) - col + 1 : 1;
        }
        if (![row, col, height, width].every(Number.isInteger) || row < 1 || col < 1 ||
            height < 1 || width < 1 || row + height - 1 > maxRows || col + width - 1 > maxColumns) {
          throw new Error('Range out of bounds');
        }
        const cell = (r, c) => rows[r - 1]?.[c - 1] ?? '';
        const range = {
          getRow: () => row, getColumn: () => col, getNumRows: () => height,
          getNumColumns: () => width, getSheet: () => sheet,
          getValues: () => Array.from({length: height}, (_, i) =>
            Array.from({length: width}, (_, j) => cell(row + i, col + j))),
          getDisplayValues: () => range.getValues().map(r => r.map(v =>
            v === true ? 'TRUE' : v === false ? 'FALSE' : String(v ?? ''))),
          getValue: () => cell(row, col), getDisplayValue: () => range.getDisplayValues()[0][0],
          getFormulas: () => range.getValues().map(r => r.map(v => typeof v === 'string' && v.startsWith('=') ? v : '')),
          getFormula: () => range.getFormulas()[0][0],
          setValues(values) {
            if (values.length !== height || values.some(r => r.length !== width)) throw new Error('Range shape differs');
            mutate({sheet: name, row, col, values: values.map(r => [...r]), method: 'setValues'}, () => {
              for (let i = 0; i < height; i++) {
                rows[row + i - 1] ??= [];
                for (let j = 0; j < width; j++) rows[row + i - 1][col + j - 1] = values[i][j];
              }
            }); return range;
          },
          setValue: value => range.setValues(Array.from({length: height}, () => Array(width).fill(value))),
          clearContent: () => range.setValue(''),
          setFormula: value => range.setValue(value), setFormulas: values => range.setValues(values),
          copyTo: () => range, insertCheckboxes: () => range,
          setDataValidation: () => range, setDataValidations: () => range,
          getDataValidations: () => Array.from({length: height}, () => Array(width).fill(null)),
          setNumberFormat: value => {formats.set(`${row}:${col}`, value); return range;},
          setBackground: () => range, setFontWeight: () => range,
          createTextFinder(value) {
            let exact = false;
            const finder = {
              matchEntireCell: yes => {exact = yes; return finder;},
              findAll: () => range.getDisplayValues().flatMap((r, i) => r.flatMap((v, j) =>
                (exact ? v === value : v.includes(value)) ? [sheet.getRange(row + i, col + j)] : [])),
              findNext: () => finder.findAll()[0] ?? null,
            }; return finder;
          },
        }; return range;
      },
    };
    sheets.set(name, sheet); return sheet;
  }
  for (const [name, rows] of Object.entries(initial)) makeSheet(name, rows);
  const workbook = {
    getSheetByName: name => sheets.get(name) ?? null,
    getSheets: () => [...sheets.values()], insertSheet: name => makeSheet(name),
    getSpreadsheetTimeZone: () => 'Europe/Moscow',
  };
  const service = {getActive: () => workbook, getActiveSpreadsheet: () => workbook,
    flush: () => {}, CopyPasteType: {PASTE_FORMAT: 'format', PASTE_DATA_VALIDATION: 'validation'}};
  return {workbook, sheets, service, writes, hooks};
}
