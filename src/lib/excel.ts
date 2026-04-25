import ExcelJS from 'exceljs';

export async function exportJsonToXlsx(params: { filename: string; sheetName: string; rows: Array<Record<string, unknown>> }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(params.sheetName);

  const rows = params.rows || [];
  const keySet = new Set<string>();
  rows.forEach((r) => Object.keys(r || {}).forEach((k) => keySet.add(k)));
  const keys = Array.from(keySet);

  ws.columns = keys.map((k) => ({
    header: k,
    key: k,
    width: Math.min(Math.max(k.length + 2, 12), 40)
  }));

  rows.forEach((r) => ws.addRow(r || {}));

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = params.filename.endsWith('.xlsx') ? params.filename : `${params.filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportWorkbookToXlsx(params: {
  filename: string;
  sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }>;
}) {
  const wb = new ExcelJS.Workbook();

  params.sheets.forEach((s) => {
    const ws = wb.addWorksheet(s.name);
    const rows = s.rows || [];
    const keySet = new Set<string>();
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => keySet.add(k)));
    const keys = Array.from(keySet);

    ws.columns = keys.map((k) => ({
      header: k,
      key: k,
      width: Math.min(Math.max(k.length + 2, 12), 40)
    }));

    rows.forEach((r) => ws.addRow(r || {}));
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = params.filename.endsWith('.xlsx') ? params.filename : `${params.filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importXlsxToJson(params: { file: File; maxRows?: number }): Promise<Array<Record<string, unknown>>> {
  const data = await params.file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headerRow = ws.getRow(1);
  const headerValues = Array.isArray(headerRow.values) ? headerRow.values : [];
  const keys = headerValues
    .slice(1)
    .map((v) => String(v ?? '').trim())
    .filter((v) => v.length > 0);

  const isUnsafeKey = (k: string) => k === '__proto__' || k === 'constructor' || k === 'prototype';
  const safeKeys = keys.map((k) => (isUnsafeKey(k) ? '' : k));

  const maxRows = params.maxRows ?? 5000;
  const out: Array<Record<string, unknown>> = [];
  const rowCount = Math.min(ws.rowCount, maxRows + 1);

  for (let r = 2; r <= rowCount; r += 1) {
    const row = ws.getRow(r);
    const obj = Object.create(null) as Record<string, unknown>;
    safeKeys.forEach((k, idx) => {
      if (!k) return;
      obj[k] = row.getCell(idx + 1).value ?? '';
    });
    if (Object.keys(obj).length > 0) out.push(obj);
  }

  return out;
}
