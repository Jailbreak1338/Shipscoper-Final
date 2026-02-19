import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { normalizeVesselName, similarity, MATCH_THRESHOLD } from './normalize';
import { fetchLatestSchedule, LatestScheduleRow } from './supabaseServer';
import { mapTerminalName } from './terminalMapping';

// Column name candidates (case-insensitive matching)
const SHIPMENT_CANDIDATES = [
  'sendungsnummer',
  'sendung',
  'shipment',
  'shipmentnumber',
  'shipmentno',
  'positionsnummer',
  'referenz',
];
const VESSEL_CANDIDATES = ['vessel', 'vesselname', 'schiff', 'ship'];
const ETA_CANDIDATES = ['eta', 'ankunft', 'arrival', 'etasoll', 'ankunftsoll'];
const TERMINAL_CANDIDATES = ['terminal', 'ct', 'terminal name'];
const CUSTOMS_CANDIDATES = ['verzollt', 'zoll', 'customs', 'custom'];

export interface ColumnMapping {
  shipmentCol?: string;
  vesselCol: string;
  etaCols: string[];
  terminalCol?: string;
  customsCol?: string;
}

export interface DetectedColumns {
  shipmentCol: string | null;
  vesselCol: string | null;
  etaCol: string | null;
  etaCols: string[];
  terminalCol: string | null;
  customsCol: string | null;
  allColumns: string[];
}

export interface MatchResult {
  row: number;
  vesselName: string;
  matched: boolean;
  matchType?: 'exact' | 'fuzzy';
  matchedName?: string;
  similarity?: number;
  eta?: string | null;
  terminal?: string | null;
}

export interface UpdateResult {
  totalRows: number;
  matched: number;
  unmatched: number;
  skippedOld: number;
  skippedCustoms: number;
  results: MatchResult[];
  unmatchedNames: string[];
  unmatchedRows: Array<{
    shipmentRef: string | null;
    vesselName: string;
    eta: string | null;
  }>;
  etaChanges: Array<{
    shipmentRef: string | null;
    vesselName: string;
    oldEta: string | null;
    newEta: string | null;
  }>;
}

/**
 * Try to auto-detect column names from the header row.
 * Uses SheetJS (lightweight, read-only — no formatting concerns).
 */
export function detectColumns(headers: string[]): DetectedColumns {
  const normalizeHeader = (h: string): string =>
    h
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '')
      .replace(/[()\-_/]/g, '');
  const normalized = headers.map(normalizeHeader);
  const findByCandidates = (candidates: string[]): string | null => {
    for (let i = 0; i < normalized.length; i++) {
      const hdr = normalized[i];
      if (candidates.some((c) => hdr.includes(c))) {
        return headers[i];
      }
    }
    return null;
  };

  const shipmentCol = findByCandidates(SHIPMENT_CANDIDATES);
  const vesselCol = findByCandidates(VESSEL_CANDIDATES);
  const terminalCol = findByCandidates(TERMINAL_CANDIDATES);
  const customsCol = findByCandidates(CUSTOMS_CANDIDATES);

  // Find ALL columns that match ETA patterns
  const etaCols: string[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const hdr = normalized[i];
    if (ETA_CANDIDATES.some((c) => hdr.includes(c))) {
      etaCols.push(headers[i]);
    }
  }
  const etaCol = etaCols[0] ?? null;

  return {
    shipmentCol,
    vesselCol,
    etaCol,
    etaCols,
    terminalCol,
    customsCol,
    allColumns: headers,
  };
}

/**
 * Format an ISO date string to "DD.MM.YYYY" in Europe/Berlin timezone.
 */
function formatETA(isoDate: string): string {
  const date = new Date(isoDate);
  const day = String(date.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit' })).padStart(2, '0');
  const month = String(date.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', month: '2-digit' })).padStart(2, '0');
  const year = date.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric' });
  return `${day}.${month}.${year}`;
}

// ---------------------------------------------------------------------------
// ExcelJS helpers
// ---------------------------------------------------------------------------

/**
 * Extract a plain text string from any ExcelJS cell value.
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toLocaleDateString('de-DE');
  if (typeof value === 'object') {
    if ('richText' in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map((rt) => rt.text).join('');
    }
    if ('formula' in value) {
      const fv = value as ExcelJS.CellFormulaValue;
      return fv.result != null ? String(fv.result) : '';
    }
    if ('sharedFormula' in value) {
      const sv = value as ExcelJS.CellSharedFormulaValue;
      return sv.result != null ? String(sv.result) : '';
    }
  }
  return String(value);
}

/**
 * Extract a Date from an ExcelJS cell value (for the ETA-age check).
 */
function cellToDate(value: ExcelJS.CellValue): Date | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    // Excel serial number → JS Date
    const epoch = new Date(1899, 11, 30);
    const d = new Date(epoch.getTime() + value * 86_400_000);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'string') {
    // DD.MM.YYYY or DD.MM.YYYY HH:MM
    const m = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) {
      return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    }
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // Formula result
  if (typeof value === 'object' && 'result' in value) {
    return cellToDate((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main processing
// ---------------------------------------------------------------------------

const EMPTY_RESULT: UpdateResult = {
  totalRows: 0,
  matched: 0,
  unmatched: 0,
  skippedOld: 0,
  skippedCustoms: 0,
  results: [],
  unmatchedNames: [],
  unmatchedRows: [],
  etaChanges: [],
};

function cellEtaText(value: ExcelJS.CellValue): string | null {
  const dt = cellToDate(value);
  if (dt) {
    const day = String(dt.getDate()).padStart(2, '0');
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const year = String(dt.getFullYear());
    return `${day}.${month}.${year}`;
  }
  const txt = cellText(value).trim();
  return txt || null;
}

/**
 * Parse an uploaded Excel buffer, match vessels against Supabase,
 * update the ETA (and optionally Terminal) columns IN-PLACE,
 * preserving all formatting, styles, column widths, merged cells, etc.
 *
 * Uses ExcelJS for the read→modify→write cycle so nothing is lost.
 */
export async function processExcel(
  fileBuffer: Buffer,
  columns: ColumnMapping
): Promise<{ updatedBuffer: Buffer; result: UpdateResult }> {
  // --- Read workbook with ExcelJS (preserves everything) ----------------
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    return { updatedBuffer: fileBuffer, result: EMPTY_RESULT };
  }

  // --- Build header map (row 1, 1-based) --------------------------------
  const headerRow = sheet.getRow(1);
  const nameToCol = new Map<string, number>(); // header name → col number (1-based)

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = cellText(cell.value).trim();
    if (name) nameToCol.set(name, colNumber);
  });

  // Resolve column numbers
  const vesselColNum = nameToCol.get(columns.vesselCol);
  if (!vesselColNum) {
    throw new Error(`Vessel column "${columns.vesselCol}" not found in sheet headers`);
  }

  const etaColNums: number[] = [];
  for (const etaName of columns.etaCols) {
    const num = nameToCol.get(etaName);
    if (num) etaColNums.push(num);
  }
  if (etaColNums.length === 0) {
    throw new Error('None of the selected ETA columns were found in sheet headers');
  }

  const terminalColNum = columns.terminalCol
    ? nameToCol.get(columns.terminalCol)
    : undefined;
  const customsColNum = columns.customsCol
    ? nameToCol.get(columns.customsCol)
    : undefined;
  const shipmentColNum = columns.shipmentCol
    ? nameToCol.get(columns.shipmentCol)
    : undefined;

  // --- Determine data range ---------------------------------------------
  const lastRowNum = sheet.lastRow?.number ?? 1;
  const firstDataRow = 2; // row after header
  const totalRows = lastRowNum - firstDataRow + 1;

  if (totalRows <= 0) {
    return { updatedBuffer: fileBuffer, result: EMPTY_RESULT };
  }

  // --- Fetch latest schedule from Supabase ------------------------------
  const scheduleRows = await fetchLatestSchedule();

  const scheduleMap = new Map<string, LatestScheduleRow>();
  for (const row of scheduleRows) {
    const existing = scheduleMap.get(row.name_normalized);
    if (!existing || new Date(row.scraped_at) > new Date(existing.scraped_at)) {
      scheduleMap.set(row.name_normalized, row);
    }
  }

  const allScheduleNames = Array.from(scheduleMap.keys());

  // --- Iterate rows, match, and update in-place -------------------------
  const results: MatchResult[] = [];
  const unmatchedNames: string[] = [];
  const unmatchedRows: UpdateResult['unmatchedRows'] = [];
  const etaChanges: UpdateResult['etaChanges'] = [];
  let matched = 0;
  let skippedOld = 0;
  let skippedCustoms = 0;

  for (let r = firstDataRow; r <= lastRowNum; r++) {
    const row = sheet.getRow(r);
    const shipmentRaw = shipmentColNum
      ? cellText(row.getCell(shipmentColNum).value).trim()
      : '';
    const shipmentRef = shipmentRaw || null;

    // Read vessel name
    const vesselRaw = cellText(row.getCell(vesselColNum).value).trim();

    // Skip rows where customs/verzollt cell is filled.
    if (customsColNum) {
      const customsText = cellText(row.getCell(customsColNum).value).trim();
      if (customsText) {
        skippedCustoms++;
        results.push({ row: r, vesselName: vesselRaw, matched: false });
        continue;
      }
    }

    if (!vesselRaw) {
      results.push({ row: r, vesselName: '', matched: false });
      unmatchedNames.push('(empty)');
      unmatchedRows.push({
        shipmentRef,
        vesselName: '(empty)',
        eta: cellEtaText(row.getCell(etaColNums[0]).value),
      });
      continue;
    }

    // Skip rows where the Excel ETA is more than 12 days old
    const etaCellValue = row.getCell(etaColNums[0]).value;
    if (etaCellValue != null) {
      const etaDate = cellToDate(etaCellValue);
      if (etaDate) {
        const daysSinceEta = Math.floor(
          (Date.now() - etaDate.getTime()) / 86_400_000
        );
        if (daysSinceEta > 12) {
          skippedOld++;
          results.push({ row: r, vesselName: vesselRaw, matched: false });
          continue;
        }
      }
    }
    const oldEta = cellEtaText(row.getCell(etaColNums[0]).value);

    const normalized = normalizeVesselName(vesselRaw);

    // Try exact match
    let scheduleEntry = scheduleMap.get(normalized) ?? null;
    let matchType: 'exact' | 'fuzzy' = 'exact';
    let bestSim = 1;

    // Fuzzy fallback
    if (!scheduleEntry) {
      matchType = 'fuzzy';
      bestSim = 0;
      let bestMatch: LatestScheduleRow | null = null;

      for (const scheduleName of allScheduleNames) {
        const sim = similarity(normalized, scheduleName);
        if (sim >= MATCH_THRESHOLD && sim > bestSim) {
          bestSim = sim;
          bestMatch = scheduleMap.get(scheduleName)!;
        } else if (sim >= MATCH_THRESHOLD && sim === bestSim && bestMatch) {
          const candidate = scheduleMap.get(scheduleName)!;
          if (new Date(candidate.scraped_at) > new Date(bestMatch.scraped_at)) {
            bestMatch = candidate;
          }
        }
      }

      scheduleEntry = bestMatch;
    }

    if (scheduleEntry) {
      const formattedEta = scheduleEntry.eta ? formatETA(scheduleEntry.eta) : null;

      // Write ETA into all selected ETA columns — only touch .value,
      // ExcelJS preserves the cell's style / font / border / fill.
      if (formattedEta) {
        for (const colNum of etaColNums) {
          row.getCell(colNum).value = formattedEta;
        }
      }

      // Write Terminal if column exists
      const mappedTerminal = mapTerminalName(scheduleEntry.terminal);
      if (terminalColNum && mappedTerminal) {
        row.getCell(terminalColNum).value = mappedTerminal;
      }

      matched++;
      if (formattedEta && oldEta && oldEta !== formattedEta) {
        etaChanges.push({
          shipmentRef,
          vesselName: vesselRaw,
          oldEta,
          newEta: formattedEta,
        });
      }
      results.push({
        row: r,
        vesselName: vesselRaw,
        matched: true,
        matchType,
        matchedName: scheduleEntry.vessel_name,
        similarity: Math.round(bestSim * 100) / 100,
        eta: formattedEta,
        terminal: mappedTerminal || scheduleEntry.terminal,
      });
    } else {
      // Write "unmatched" into all selected ETA columns
      for (const colNum of etaColNums) {
        row.getCell(colNum).value = 'unmatched';
      }
      results.push({
        row: r,
        vesselName: vesselRaw,
        matched: false,
      });
      unmatchedNames.push(vesselRaw);
      unmatchedRows.push({
        shipmentRef,
        vesselName: vesselRaw,
        eta: oldEta,
      });
    }
  }

  // --- Write workbook back (ExcelJS preserves all formatting) -----------
  const outputArrayBuffer = await workbook.xlsx.writeBuffer();
  const updatedBuffer = Buffer.from(outputArrayBuffer);

  return {
    updatedBuffer,
    result: {
      totalRows,
      matched,
      unmatched: totalRows - matched - skippedOld - skippedCustoms,
      skippedOld,
      skippedCustoms,
      results,
      unmatchedNames: unmatchedNames.slice(0, 20),
      unmatchedRows: unmatchedRows.slice(0, 20),
      etaChanges: etaChanges.slice(0, 50),
    },
  };
}
