/**
 * Generate a sample Excel file for testing the ETA Updater.
 *
 * Usage: npx tsx scripts/generate_sample_excel.ts
 *
 * Creates: sample_vessels.xlsx in the project root.
 */

import * as XLSX from 'xlsx';
import path from 'path';

const vessels = [
  { 'Vessel Name': 'MSC OSCAR', ETA: '', Terminal: '' },
  { 'Vessel Name': 'EVER GIVEN', ETA: '', Terminal: '' },
  { 'Vessel Name': 'CMA CGM MARCO POLO', ETA: '', Terminal: '' },
  { 'Vessel Name': 'HAPAG LLOYD EXPRESS', ETA: '', Terminal: '' },
  { 'Vessel Name': 'MAERSK SEALAND', ETA: '', Terminal: '' },
  { 'Vessel Name': 'COSCO SHIPPING TAURUS', ETA: '', Terminal: '' },
  { 'Vessel Name': 'MOL TRIUMPH', ETA: '', Terminal: '' },
  { 'Vessel Name': 'OOCL HONG KONG', ETA: '', Terminal: '' },
  // Fuzzy match candidates (slightly different names)
  { 'Vessel Name': 'MSC OSCAR II', ETA: '', Terminal: '' },
  { 'Vessel Name': 'EVER GIVN', ETA: '', Terminal: '' },
  // Unknown vessels (should remain unmatched)
  { 'Vessel Name': 'UNKNOWN VESSEL', ETA: '', Terminal: '' },
  { 'Vessel Name': 'TEST SHIP 123', ETA: '', Terminal: '' },
];

const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.json_to_sheet(vessels);

// Set column widths
sheet['!cols'] = [
  { wch: 25 }, // Vessel Name
  { wch: 20 }, // ETA
  { wch: 15 }, // Terminal
];

XLSX.utils.book_append_sheet(workbook, sheet, 'Vessels');

const outputPath = path.join(process.cwd(), 'sample_vessels.xlsx');
XLSX.writeFile(workbook, outputPath);

console.log(`Sample Excel file created: ${outputPath}`);
console.log(`Contains ${vessels.length} vessel entries`);
console.log('  - 8 exact match candidates');
console.log('  - 2 fuzzy match candidates');
console.log('  - 2 unknown vessels (should remain unmatched)');
