// ============================================================================
// Import Pipeline — Shared Utilities
// ============================================================================
// File hashing, Excel parsing, date helpers, validation helpers.
// ============================================================================

import * as crypto from "crypto";
import * as XLSX from "xlsx";
import type { SpreadsheetRow, AmazonReportMeta } from "./types";

// ----- File hashing (duplicate detection) -----

/** SHA-256 hash of file contents. Used to block duplicate uploads. */
export function hashFileBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// ----- Excel / CSV parsing -----

/** Parse an Excel or CSV file buffer into rows. Returns header row + data rows. */
export function parseSpreadsheet(
  buffer: Buffer,
  fileName: string,
  options?: { headerRow?: number; sheetIndex?: number }
): { headers: string[]; rows: SpreadsheetRow[] } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[options?.sheetIndex ?? 0];
  const sheet = workbook.Sheets[sheetName];

  const headerRow = options?.headerRow ?? 0;

  // Get raw 2D array
  const rawData: (string | number | Date | null)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });

  if (rawData.length <= headerRow) {
    return { headers: [], rows: [] };
  }

  const headers = (rawData[headerRow] as (string | null)[]).map((h) =>
    h ? String(h).trim() : ""
  );

  const rows: SpreadsheetRow[] = [];
  for (let i = headerRow + 1; i < rawData.length; i++) {
    const rawRow = rawData[i];
    if (!rawRow || rawRow.every((cell) => cell === null || cell === "")) continue;

    const row: SpreadsheetRow = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) {
        row[headers[j]] = rawRow[j] != null ? rawRow[j] as string | number : null;
      }
    }
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Parse Amazon report metadata from row 0.
 * Amazon reports have a metadata row with filter info like:
 *   Program=[Retail]  View By=[ASIN]  Viewing Range=[3/2/26 - 4/2/26]  etc.
 */
export function parseAmazonMeta(buffer: Buffer): AmazonReportMeta {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData: (string | null)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });

  const meta: AmazonReportMeta = {};
  if (!rawData[0]) return meta;

  const metaRow = rawData[0].map((c) => (c ? String(c) : "")).join("\t");

  // Extract viewing range: "Viewing Range=[3/2/26 - 4/2/26]"
  const rangeMatch = metaRow.match(/Viewing Range=\[([^\]]+)\]/);
  if (rangeMatch) {
    const parts = rangeMatch[1].split(" - ");
    if (parts.length === 2) {
      meta.reportDateRange = {
        start: parseFlexibleDate(parts[0].trim()),
        end: parseFlexibleDate(parts[1].trim()),
      };
    }
  }

  // Extract report updated date: "Report Updated=[4/2/26]"
  const updatedMatch = metaRow.match(/Report Updated=\[([^\]]+)\]/);
  if (updatedMatch) {
    meta.reportUpdated = parseFlexibleDate(updatedMatch[1].trim());
  }

  // Extract forecast statistic: "Forecasting Statistic=[Mean]"
  const statMatch = metaRow.match(/Forecasting Statistic=\[([^\]]+)\]/);
  if (statMatch) {
    meta.forecastStatistic = statMatch[1].trim();
  }

  return meta;
}

// ----- Date parsing -----

/**
 * Parse dates in many formats:
 *   M/D/YY, M/D/YYYY, YYYY-MM-DD, MM/DD/YYYY
 * Amazon reports use short year format like "3/2/26"
 */
export function parseFlexibleDate(value: string): Date {
  const s = value.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    return new Date(s + "T00:00:00");
  }

  // M/D/YY or M/D/YYYY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let year = parseInt(slashMatch[3]);
    if (year < 100) year += 2000; // "26" → 2026
    const month = parseInt(slashMatch[1]) - 1;
    const day = parseInt(slashMatch[2]);
    return new Date(year, month, day);
  }

  // Fallback
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    throw new Error(`Cannot parse date: "${value}"`);
  }
  return d;
}

/** Format a Date to YYYY-MM-DD string */
export function toDateString(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Parse a month column header like "Apr-25" or "2025-04" into start/end dates */
export function parseMonthColumn(header: string): { start: Date; end: Date } | null {
  // "Apr-25", "Apr 25", "Apr-2025"
  const monthNames: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const abbrevMatch = header.trim().match(/^([A-Za-z]{3})[\s-](\d{2,4})$/);
  if (abbrevMatch) {
    const monthIdx = monthNames[abbrevMatch[1].toLowerCase()];
    if (monthIdx !== undefined) {
      let year = parseInt(abbrevMatch[2]);
      if (year < 100) year += 2000;
      const start = new Date(year, monthIdx, 1);
      const end = new Date(year, monthIdx + 1, 0); // Last day of month
      return { start, end };
    }
  }

  // "2025-04"
  const isoMatch = header.trim().match(/^(\d{4})-(\d{2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]);
    const monthIdx = parseInt(isoMatch[2]) - 1;
    const start = new Date(year, monthIdx, 1);
    const end = new Date(year, monthIdx + 1, 0);
    return { start, end };
  }

  return null;
}

/**
 * Parse Amazon forecast week header: "Week 0 (29 Mar - 4 Apr)"
 * Returns week number + start/end dates
 */
export function parseForecastWeekHeader(header: string): {
  weekNumber: number;
  startDate: Date;
  endDate: Date;
} | null {
  const match = header.match(/Week\s+(\d+)\s+\(([^)]+)\)/);
  if (!match) return null;

  const weekNumber = parseInt(match[1]);
  const rangeParts = match[2].split(" - ");
  if (rangeParts.length !== 2) return null;

  // "29 Mar" and "4 Apr" — need to infer year from context
  // We'll assume current year, adjusting if the date wraps into next year
  const currentYear = new Date().getFullYear();

  function parseDayMonth(s: string, referenceYear: number): Date {
    const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})$/);
    if (!m) throw new Error(`Cannot parse forecast date: "${s}"`);
    const day = parseInt(m[1]);
    const monthNames: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const monthIdx = monthNames[m[2].toLowerCase()];
    if (monthIdx === undefined) throw new Error(`Unknown month: "${m[2]}"`);
    return new Date(referenceYear, monthIdx, day);
  }

  try {
    let startDate = parseDayMonth(rangeParts[0], currentYear);
    let endDate = parseDayMonth(rangeParts[1], currentYear);

    // If end is before start, the range crosses a year boundary
    if (endDate < startDate) {
      endDate = parseDayMonth(rangeParts[1], currentYear + 1);
    }

    return { weekNumber, startDate, endDate };
  } catch {
    return null;
  }
}

// ----- Validation helpers -----

/** Check if a value is a positive integer */
export function isPositiveInt(val: unknown): val is number {
  if (val === null || val === undefined || val === "") return false;
  const n = Number(val);
  return Number.isInteger(n) && n > 0;
}

/** Check if a value is zero or positive integer */
export function isNonNegativeInt(val: unknown): val is number {
  if (val === null || val === undefined || val === "") return false;
  const n = Number(val);
  return Number.isInteger(n) && n >= 0;
}

/** Check if a value is a valid number (including decimals) */
export function isValidNumber(val: unknown): boolean {
  if (val === null || val === undefined || val === "") return false;
  return !isNaN(Number(val));
}

/** Safely convert a cell value to a number, returning null if not valid */
export function toNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const s = String(val).replace(/[$,%]/g, "").trim();
  const n = Number(s);
  return isNaN(n) ? null : n;
}

/** Safely convert a cell value to an integer */
export function toInt(val: unknown): number | null {
  const n = toNumber(val);
  if (n === null) return null;
  return Math.round(n);
}
