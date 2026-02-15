/**
 * Normalize a vessel name for matching:
 * - trim whitespace
 * - uppercase
 * - collapse multiple spaces into one
 */
export function normalizeVesselName(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Compute similarity between two strings (0..1) using Levenshtein distance.
 * Uses fast-levenshtein for the distance calculation.
 */
export function similarity(a: string, b: string): number {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const lev = require('fast-levenshtein');
  const distance: number = lev.get(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - distance / maxLen;
}

export const MATCH_THRESHOLD = parseFloat(
  process.env.MATCH_THRESHOLD || '0.85'
);
