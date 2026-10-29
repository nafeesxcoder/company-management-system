/**
 * Minimal, dependency-free CSV writer.
 *
 * Two things matter here beyond quoting:
 *   - a UTF-8 BOM, so Excel opens non-ASCII (₹, names) correctly rather than as
 *     mojibake;
 *   - formula-injection neutralisation, because a cell beginning =, +, - or @
 *     is executed by Excel and Sheets when the file is opened. A vendor name of
 *     `=HYPERLINK(...)` in an exported expense report is a real attack.
 */

const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let str = value instanceof Date ? value.toISOString() : String(value);

  // Prefix with a single quote so spreadsheets treat it as text, not a formula.
  if (DANGEROUS_PREFIX.test(str)) str = `'${str}`;

  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) {
    return columns?.length ? `﻿${columns.join(',')}\n` : '﻿';
  }

  const headers = columns ?? Object.keys(rows[0]!);
  const lines = [headers.join(',')];

  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(','));
  }

  // BOM + CRLF for maximum spreadsheet compatibility.
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Safe, dated download filename. */
export function csvFilename(prefix: string, range?: { from: Date; to: Date }): string {
  const clean = prefix.replace(/[^a-zA-Z0-9_-]/g, '-');
  if (!range) return `${clean}-${new Date().toISOString().slice(0, 10)}.csv`;
  return `${clean}-${range.from.toISOString().slice(0, 10)}-to-${range.to.toISOString().slice(0, 10)}.csv`;
}
