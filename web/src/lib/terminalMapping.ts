export const TERMINAL_MAPPINGS: Record<string, string> = {
  'CTB': 'HHLA Burchardkai',
  'CTA': 'HHLA Altenwerder',
  'CTT': 'HHLA Tollerort',
  'Eurogate': 'Eurogate',
  'EUROGATE': 'Eurogate',
};

export function mapTerminalName(code: string | null | undefined): string {
  if (!code) return '';

  // Try exact match
  if (code in TERMINAL_MAPPINGS) {
    return TERMINAL_MAPPINGS[code];
  }

  // Try case-insensitive
  const upperCode = code.toUpperCase();
  for (const [key, value] of Object.entries(TERMINAL_MAPPINGS)) {
    if (key.toUpperCase() === upperCode) {
      return value;
    }
  }

  // Return original if no mapping found
  return code;
}
