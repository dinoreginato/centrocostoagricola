import ExcelJSImport from 'exceljs/dist/exceljs.bare.min.js';
import type * as ExcelJSTypes from 'exceljs';

const ExcelJS = ExcelJSImport as unknown as { Workbook: new () => ExcelJSTypes.Workbook };

function sanitizeSheetName(name: string) {
  return String(name || '')
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || 'Hoja';
}

export async function exportJsonToXlsx(params: { filename: string; sheetName: string; rows: Array<Record<string, unknown>> }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sanitizeSheetName(params.sheetName));

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
    const ws = wb.addWorksheet(sanitizeSheetName(s.name));
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

export async function exportDetailedSegmentedToXlsx(params: {
  filename: string;
  rows: Array<{
    Mes: string;
    Categoría: string;
    Fecha: string;
    Proveedor: string;
    'N° Factura': string;
    Detalle: string;
    Monto: number;
  }>;
}) {
  const wb = new ExcelJS.Workbook();
  const rows = params.rows || [];

  const wsDetail = wb.addWorksheet('Detalle');
  wsDetail.columns = [
    { header: 'Mes', key: 'Mes', width: 14 },
    { header: 'Categoría', key: 'Categoría', width: 24 },
    { header: 'Fecha', key: 'Fecha', width: 12 },
    { header: 'Proveedor', key: 'Proveedor', width: 28 },
    { header: 'N° Factura', key: 'N° Factura', width: 16 },
    { header: 'Detalle', key: 'Detalle', width: 60 },
    { header: 'Monto', key: 'Monto', width: 16 }
  ];
  rows.forEach((r) => wsDetail.addRow(r));
  wsDetail.views = [{ state: 'frozen', ySplit: 1 }];
  wsDetail.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
  wsDetail.getColumn('Monto').numFmt = '#,##0';
  wsDetail.getColumn('Monto').alignment = { horizontal: 'right' };

  const summaryMap = new Map<string, number>();
  rows.forEach((r) => {
    const key = `${r.Mes}||${r.Categoría}`;
    summaryMap.set(key, (summaryMap.get(key) || 0) + (Number(r.Monto) || 0));
  });
  const summaryRows = Array.from(summaryMap.entries())
    .map(([key, total]) => {
      const [Mes, Categoría] = key.split('||');
      return { Mes, Categoría, Total: total };
    })
    .sort((a, b) => (a.Mes + a.Categoría).localeCompare(b.Mes + b.Categoría));

  const wsSummary = wb.addWorksheet('Resumen');
  wsSummary.columns = [
    { header: 'Mes', key: 'Mes', width: 14 },
    { header: 'Categoría', key: 'Categoría', width: 24 },
    { header: 'Total', key: 'Total', width: 16 }
  ];
  summaryRows.forEach((r) => wsSummary.addRow(r));
  wsSummary.views = [{ state: 'frozen', ySplit: 1 }];
  wsSummary.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 3 } };
  wsSummary.getColumn('Total').numFmt = '#,##0';
  wsSummary.getColumn('Total').alignment = { horizontal: 'right' };

  const monthMap = new Map<string, Array<typeof rows[number]>>();
  rows.forEach((r) => {
    monthMap.set(r.Mes, [...(monthMap.get(r.Mes) || []), r]);
  });

  const months = Array.from(monthMap.keys());
  months.forEach((monthName) => {
    const sheetName = sanitizeSheetName(monthName);
    const ws = wb.addWorksheet(sheetName);
    ws.columns = [
      { header: 'Fecha', key: 'Fecha', width: 12 },
      { header: 'Proveedor', key: 'Proveedor', width: 28 },
      { header: 'N° Factura', key: 'N° Factura', width: 16 },
      { header: 'Detalle', key: 'Detalle', width: 60 },
      { header: 'Monto', key: 'Monto', width: 16 }
    ];

    const titleRow = ws.addRow([`Mes: ${monthName}`]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, 5);
    titleRow.font = { bold: true, size: 14 };
    titleRow.alignment = { vertical: 'middle', horizontal: 'left' };
    titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    ws.addRow([]);

    const byCategory = new Map<string, Array<typeof rows[number]>>();
    (monthMap.get(monthName) || []).forEach((r) => {
      byCategory.set(r.Categoría, [...(byCategory.get(r.Categoría) || []), r]);
    });

    Array.from(byCategory.entries())
      .map(([name, items]) => ({
        name,
        items: items.slice().sort((a, b) => String(a.Fecha || '').localeCompare(String(b.Fecha || ''))),
        total: items.reduce((sum, it) => sum + (Number(it.Monto) || 0), 0)
      }))
      .sort((a, b) => b.total - a.total)
      .forEach((cat) => {
        const headerRow = ws.addRow([cat.name, '', '', '', cat.total]);
        ws.mergeCells(headerRow.number, 1, headerRow.number, 4);
        headerRow.font = { bold: true };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
        headerRow.getCell(5).numFmt = '#,##0';
        headerRow.getCell(5).alignment = { horizontal: 'right' };

        const colsRow = ws.addRow(['Fecha', 'Proveedor', 'N° Factura', 'Detalle', 'Monto']);
        colsRow.font = { bold: true };
        colsRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        colsRow.alignment = { vertical: 'middle' };

        cat.items.forEach((it) => {
          const r = ws.addRow([it.Fecha, it.Proveedor, it['N° Factura'], it.Detalle, Number(it.Monto) || 0]);
          r.getCell(5).numFmt = '#,##0';
          r.getCell(5).alignment = { horizontal: 'right' };
          r.getCell(4).alignment = { wrapText: true };
        });

        ws.addRow([]);
      });
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
