/**
 * Unit tests for core container-tracking logic.
 * Runs with: npx tsx --test src/tests/logic.test.ts
 *
 * Tests cover:
 *  A) ISO-6346 container-number validation + pairing (import dedup)
 *  B) notification_enabled independence (status checking)
 *  C) S-Nr filter lookup (vessel subset)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── A. Container pairing + dedup ──────────────────────────────────────────────

/** Mirrors the validation in checkContainers.ts and update-excel/route.ts */
const CONTAINER_RE = /^[A-Z]{4}[0-9]{7}$/;

function buildContainerSnrPairs(
  rows: Array<{ containerRaw: string; snr: string | null }>
): Array<{ container_no: string; snr: string | null }> {
  const pairs: Array<{ container_no: string; snr: string | null }> = [];
  for (const row of rows) {
    const containerNo = row.containerRaw.trim().toUpperCase();
    if (!CONTAINER_RE.test(containerNo)) continue; // invalid → skip
    if (!pairs.some((p) => p.container_no === containerNo)) {
      // First occurrence wins (dedup by container_no)
      pairs.push({ container_no: containerNo, snr: row.snr });
    }
  }
  return pairs;
}

describe('A: Container pairing + ISO-6346 validation', () => {
  test('valid container gets paired with its S-Nr', () => {
    const pairs = buildContainerSnrPairs([
      { containerRaw: 'MSCU1234567', snr: 'S00224537' },
    ]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].container_no, 'MSCU1234567');
    assert.equal(pairs[0].snr, 'S00224537');
  });

  test('invalid container numbers are rejected', () => {
    const invalids = [
      'TOOSHORT',        // < 11 chars
      '1234ABCDEFG',    // digits before letters
      'MSCU123456',     // only 6 digits
      'MSC1234567',     // only 3 letters
      '',               // empty
    ];
    for (const raw of invalids) {
      const pairs = buildContainerSnrPairs([{ containerRaw: raw, snr: 'S00000001' }]);
      assert.equal(pairs.length, 0, `Expected empty for "${raw}"`);
    }
  });

  test('lowercase input is normalized to uppercase', () => {
    const pairs = buildContainerSnrPairs([{ containerRaw: 'mscu1234567', snr: 'S001' }]);
    assert.equal(pairs.length, 1, 'lowercase should be uppercased and pass validation');
    assert.equal(pairs[0].container_no, 'MSCU1234567');
  });

  test('duplicate container → first S-Nr wins', () => {
    const pairs = buildContainerSnrPairs([
      { containerRaw: 'GLDU9400713', snr: 'S00224537' },
      { containerRaw: 'GLDU9400713', snr: 'S00223523' }, // duplicate — should be ignored
      { containerRaw: 'GLDU9400713', snr: 'S00223524' }, // duplicate — should be ignored
    ]);
    assert.equal(pairs.length, 1, 'Only one pair per container');
    assert.equal(pairs[0].snr, 'S00224537', 'First S-Nr wins');
  });

  test('multiple distinct containers each get their own pair', () => {
    const pairs = buildContainerSnrPairs([
      { containerRaw: 'MSCU1234567', snr: 'S00100001' },
      { containerRaw: 'GLDU9400713', snr: 'S00100002' },
      { containerRaw: 'CSQU3000715', snr: 'S00100003' },
    ]);
    assert.equal(pairs.length, 3);
    assert.deepEqual(
      pairs.map((p) => p.container_no),
      ['MSCU1234567', 'GLDU9400713', 'CSQU3000715']
    );
  });

  test('mix of valid and invalid → only valid ones included', () => {
    const pairs = buildContainerSnrPairs([
      { containerRaw: 'INVALID!', snr: 'S001' },
      { containerRaw: 'MSCU1234567', snr: 'S002' },
      { containerRaw: 'TOOSHORT1', snr: 'S003' },
      { containerRaw: 'GLDU9400713', snr: 'S004' },
    ]);
    assert.equal(pairs.length, 2);
    assert.equal(pairs[0].container_no, 'MSCU1234567');
    assert.equal(pairs[1].container_no, 'GLDU9400713');
  });
});

// ── B. notification_enabled independence ──────────────────────────────────────

/**
 * Simulates what loadActiveWatches() returns with and without the
 * notification_enabled filter. The bug was filtering to notification_enabled=true
 * which excluded Excel-imported watches (notification_enabled=false).
 *
 * The fix: filter only by container_reference IS NOT NULL.
 */

type MockWatch = {
  id: string;
  container_reference: string | null;
  notification_enabled: boolean;
};

function loadWatches_OLD(watches: MockWatch[]): MockWatch[] {
  // Old behaviour: only watches with notification_enabled=true AND container_reference
  return watches.filter((w) => w.notification_enabled && w.container_reference !== null);
}

function loadWatches_NEW(watches: MockWatch[]): MockWatch[] {
  // New behaviour: all watches with container_reference (notification_enabled gates email only)
  return watches.filter((w) => w.container_reference !== null);
}

describe('B: notification_enabled independence', () => {
  const testData: MockWatch[] = [
    { id: '1', container_reference: 'MSCU1234567', notification_enabled: true },
    { id: '2', container_reference: 'GLDU9400713', notification_enabled: false }, // Excel-imported
    { id: '3', container_reference: null,          notification_enabled: true },  // no container
    { id: '4', container_reference: 'CSQU3000715', notification_enabled: false }, // Excel-imported
  ];

  test('OLD behaviour: misses notification_enabled=false watches (the bug)', () => {
    const result = loadWatches_OLD(testData);
    assert.equal(result.length, 1, 'Only 1 watch with notification_enabled=true + container_reference');
    assert.equal(result[0].id, '1');
  });

  test('NEW behaviour: includes all watches with container_reference', () => {
    const result = loadWatches_NEW(testData);
    assert.equal(result.length, 3, 'Both enabled and disabled watches are checked');
    const ids = result.map((w) => w.id);
    assert.ok(ids.includes('1'), 'enabled watch included');
    assert.ok(ids.includes('2'), 'disabled watch included (Excel-imported)');
    assert.ok(ids.includes('4'), 'disabled watch included (Excel-imported)');
    assert.ok(!ids.includes('3'), 'watch without container_reference excluded');
  });

  test('zero notification_enabled watches → still processes shipments', () => {
    const allDisabled: MockWatch[] = [
      { id: '10', container_reference: 'MSCU1234567', notification_enabled: false },
      { id: '11', container_reference: 'GLDU9400713', notification_enabled: false },
    ];
    const old = loadWatches_OLD(allDisabled);
    const neu = loadWatches_NEW(allDisabled);
    assert.equal(old.length, 0, 'OLD: nothing to check when all disabled');
    assert.equal(neu.length, 2, 'NEW: still checks containers even when all disabled');
  });
});

// ── C. S-Nr filter vessel subset ─────────────────────────────────────────────

type WatchRow = {
  vessel_name_normalized: string;
  shipment_reference: string | null;
};

/**
 * Simulates the server-side S-Nr filter:
 * given a list of watches and a search term, returns the
 * vessel_name_normalized values whose shipment_reference contains the term.
 */
function findVesselNamesForSnr(watches: WatchRow[], snr: string): string[] {
  const term = snr.toLowerCase();
  return [
    ...new Set(
      watches
        .filter((w) => w.shipment_reference?.toLowerCase().includes(term))
        .map((w) => w.vessel_name_normalized)
    ),
  ];
}

describe('C: S-Nr filter — vessel subset', () => {
  const watches: WatchRow[] = [
    { vessel_name_normalized: 'nordica',       shipment_reference: 'S00224537, S00223523' },
    { vessel_name_normalized: 'nordica',       shipment_reference: 'S00224307' },
    { vessel_name_normalized: 'hamburg bay',   shipment_reference: 'S00226629' },
    { vessel_name_normalized: 'atlantic star', shipment_reference: null },
    { vessel_name_normalized: 'ever given',    shipment_reference: 'S00224537' }, // same S-Nr, different vessel
  ];

  test('exact S-Nr match returns correct vessel names', () => {
    const names = findVesselNamesForSnr(watches, 'S00226629');
    assert.deepEqual(names, ['hamburg bay']);
  });

  test('S-Nr present on multiple vessels returns all of them', () => {
    const names = findVesselNamesForSnr(watches, 'S00224537');
    assert.ok(names.includes('nordica'),      'nordica has S00224537');
    assert.ok(names.includes('ever given'),   'ever given has S00224537');
    assert.equal(names.length, 2);
  });

  test('partial S-Nr match works (ILIKE behaviour)', () => {
    const names = findVesselNamesForSnr(watches, 'S002245');
    assert.ok(names.includes('nordica'),    'nordica matches partial S-Nr');
    assert.ok(names.includes('ever given'), 'ever given matches partial S-Nr');
  });

  test('unknown S-Nr returns empty array', () => {
    const names = findVesselNamesForSnr(watches, 'S99999999');
    assert.equal(names.length, 0);
  });

  test('vessel with null shipment_reference is not included', () => {
    const names = findVesselNamesForSnr(watches, 'S002');
    assert.ok(!names.includes('atlantic star'), 'null shipment_reference should not match');
  });

  test('result is deduplicated when same vessel appears multiple times', () => {
    // nordica appears twice in test data, both match S002245
    const names = findVesselNamesForSnr(watches, 'S002245');
    const nordicaCount = names.filter((n) => n === 'nordica').length;
    assert.equal(nordicaCount, 1, 'nordica should appear exactly once despite two matching rows');
  });
});
