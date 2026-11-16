import ExcelJS from 'exceljs';
import { AppError } from './AppError.js';

// Excel templates and parsing shared by every module's import/export.
// Templates are plain tables: one header row, one record per row. Columns are matched by header
// text (case-insensitive) or by key, so users may reorder columns or add their own notes columns.

export interface ExcelColumn {
  key: string;
  header: string;
  /** Shown as a cell note on the header: rules, allowed values, units. */
  note?: string;
  required?: boolean;
  width?: number;
}

export type CellValue = string | number | boolean | Date | null;

export interface SheetRow {
  /** 1-based row number in the sheet, for error messages. */
  row: number;
  values: Record<string, CellValue>;
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F0E1' } };

/** Builds an .xlsx with one sheet: styled header row (+ notes), optional data rows. */
export const buildWorkbook = async (
  sheetName: string,
  columns: ExcelColumn[],
  rows: Record<string, unknown>[] = [],
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AINP-NF PMS';
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.columns = columns.map((c) => ({
    key: c.key,
    header: c.header,
    width: c.width ?? Math.max(14, c.header.length + 4),
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = HEADER_FILL;
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    const note = [c.required ? 'Required.' : 'Optional.', c.note].filter(Boolean).join(' ');
    cell.note = note;
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, row[c.key] ?? null])));

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

const normalise = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, ' ').replace(/[*]/g, '').trim();

const cellValue = (cell: ExcelJS.Cell): CellValue => {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'object') {
    if ('result' in v) return (v.result as CellValue) ?? null; // formula
    if ('richText' in v)
      return (
        v.richText
          .map((t) => t.text)
          .join('')
          .trim() || null
      );
    if ('text' in v) return String(v.text).trim() || null; // hyperlink
  }
  return String(v);
};

/**
 * Reads the first sheet of an uploaded workbook into rows keyed by column key.
 * Throws 400 if the file isn't a readable .xlsx or required headers are missing.
 */
export const readRows = async (buffer: Buffer, columns: ExcelColumn[]): Promise<SheetRow[]> => {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw AppError.badRequest('INVALID_FILE', 'The file is not a readable .xlsx workbook');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw AppError.badRequest('INVALID_FILE', 'The workbook has no sheets');

  // Map header cells to column keys.
  const byHeader = new Map<string, string>();
  for (const c of columns) {
    byHeader.set(normalise(c.header), c.key);
    byHeader.set(normalise(c.key), c.key);
  }
  const colIndex = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, i) => {
    const key = byHeader.get(normalise(String(cellValue(cell) ?? '')));
    if (key && !colIndex.has(key)) colIndex.set(key, i);
  });
  const missing = columns.filter((c) => c.required && !colIndex.has(c.key)).map((c) => c.header);
  if (missing.length) {
    throw AppError.badRequest('MISSING_COLUMNS', `Missing required column(s): ${missing.join(', ')}`, {
      missing,
    });
  }

  const rows: SheetRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Record<string, CellValue> = {};
    for (const [key, index] of colIndex) values[key] = cellValue(row.getCell(index));
    if (Object.values(values).some((v) => v !== null)) rows.push({ row: rowNumber, values });
  });
  return rows;
};
