/**
 * CSV for exports (RFC 4180), written for a spreadsheet that will open the file.
 *
 * - UTF-8 with a byte order mark, so Excel reads rupee signs and names correctly.
 * - CRLF between records, fields quoted only when they must be.
 * - FORMULA INJECTION: a text cell whose first visible character is `=`, `+`, `-` or `@` (or whose
 *   first raw character is a tab or carriage return) is prefixed with a single quote, so a
 *   spreadsheet shows it as text instead of running it. This applies to EVERY text cell, names and
 *   notes included: anything a visitor or a teammate typed is untrusted.
 * - Numbers stay numbers only when the caller hands over a `number` or a `csvDecimal`. Those are
 *   values the service computed (a count, an exact money string), never text a person typed, so
 *   they are the one thing the quote prefix skips (a refund of "-12.50" must stay a number).
 */

export const CSV_BOM = '\uFEFF';
export const CSV_EOL = '\r\n';

/** A plain decimal kept as digits ("1250.50", "-3"), made by `csvDecimal` only. */
export interface CsvDecimal {
  readonly decimal: string;
}

export type CsvCell = string | number | CsvDecimal | null | undefined;

const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** Wraps exact decimal text, e.g. `minorToDecimal(125050, 'INR')`. Throws on anything that is not strictly digits, so a typed value can never ride along as a "number". */
export function csvDecimal(value: string): CsvDecimal {
  if (!DECIMAL.test(value)) throw new Error('csvDecimal needs plain decimal digits');
  return { decimal: value };
}

// C0 controls other than tab, LF and CR, and DEL: they mean nothing in a spreadsheet and some readers choke on them.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// What "trimming" means before the formula check: every Unicode space (\s covers tab, CR, LF, NBSP, the BOM and the
// line separators) plus the zero-width characters a pasted value can hide behind.
const LEADING_BLANKS = /^[\s\u200b-\u200d\u2060\ufeff]+/;
const FORMULA_START = /^[=+\-@]/;
const RAW_TAB_OR_CR = /^[\t\r]/;

/** Makes a text cell safe to open in a spreadsheet: a leading `'` when it could be read as a formula. */
export function neutraliseFormula(text: string): string {
  const visible = text.replace(LEADING_BLANKS, '');
  return RAW_TAB_OR_CR.test(text) || FORMULA_START.test(visible) ? `'${text}` : text;
}

// A field needs quotes when it holds a quote, a comma or a line break, and (so no reader trims them) at its edges whitespace.
const NEEDS_QUOTES = /["\r\n,]|^\s|\s$/;

function quote(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One cell as it is written into the file. */
export function csvField(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return '';
    const text = String(cell);
    if (DECIMAL.test(text)) return text;
    // Exponent forms ("1e-7") are not what a person expects to find in a money or count column.
    const fixed = cell.toFixed(6).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return DECIMAL.test(fixed) ? fixed : '';
  }
  if (typeof cell === 'object') return DECIMAL.test(cell.decimal) ? cell.decimal : '';
  return quote(neutraliseFormula(cell.replace(CONTROL, '')));
}

export function csvRow(cells: readonly CsvCell[]): string {
  return cells.map(csvField).join(',');
}

/** The whole file: BOM, the header, then one record per row, each ended with CRLF. Every row must be as wide as the header. */
export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly CsvCell[]>, options: { bom?: boolean } = {}): string {
  const lines = [csvRow(header)];
  for (const row of rows) {
    if (row.length !== header.length) throw new Error(`CSV row has ${row.length} cells but the header has ${header.length}`);
    lines.push(csvRow(row));
  }
  return (options.bom === false ? '' : CSV_BOM) + lines.join(CSV_EOL) + CSV_EOL;
}
