'use client';

import { useMemo, useState, type CSSProperties } from 'react';

export type SearchRow = {
  vessel_name: string;
  vessel_name_normalized: string;
  source: string;
  eta: string | null;
  etd: string | null;
  terminal: string | null;
  scraped_at: string;
  previous_eta: string | null;
  eta_change_days: number | null;
};

type ShipmentMap = Record<string, string[]>;

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
  });
}

function formatEtaChange(days: number | null): string {
  if (days == null || days === 0) return '-';
  return `${days > 0 ? '+' : ''}${days} Tage`;
}

function parseShipmentValues(input: string | null | undefined): string[] {
  return String(input ?? '')
    .split(/[;,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export default function ScheduleSearchTable({
  rows,
  initiallyWatched,
  initialShipmentByVessel,
  initialContainerByVessel,
  initialSnrFilter,
}: {
  rows: SearchRow[];
  initiallyWatched: string[];
  initialShipmentByVessel: ShipmentMap;
  initialContainerByVessel: ShipmentMap;
  initialSnrFilter?: string;
}) {
  const [watchedSet, setWatchedSet] = useState<Set<string>>(
    () => new Set(initiallyWatched)
  );
  const [shipmentByVessel, setShipmentByVessel] =
    useState<ShipmentMap>(initialShipmentByVessel);
  const [containerByVessel] =
    useState<ShipmentMap>(initialContainerByVessel);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState('');
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [shipmentInput, setShipmentInput] = useState<Record<string, string>>({});
  const [shipmentSuggestions, setShipmentSuggestions] = useState<Record<string, string[]>>({});
  const [snrFilter, setSnrFilter] = useState(initialSnrFilter ?? '');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [onlyWithSnr, setOnlyWithSnr] = useState(false);

  const uniqueVesselsOnPage = useMemo(() => {
    const names = new Set(rows.map((r) => r.vessel_name_normalized));
    return names.size;
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = snrFilter.trim().toLowerCase();

    return rows.filter((row) => {
      const vesselShipments = shipmentByVessel[row.vessel_name_normalized] ?? [];
      if (onlyUnassigned && vesselShipments.length > 0) return false;
      if (onlyWithSnr && vesselShipments.length === 0) return false;
      if (!q) return true;
      return vesselShipments.some((snr) => snr.toLowerCase().includes(q));
    });
  }, [rows, shipmentByVessel, snrFilter, onlyUnassigned, onlyWithSnr]);

  const fetchShipmentSuggestions = async (key: string, query: string) => {
    if (query.trim().length < 2) {
      setShipmentSuggestions((prev) => ({ ...prev, [key]: [] }));
      return;
    }

    try {
      const res = await fetch(`/api/shipment-numbers/search?q=${encodeURIComponent(query.trim())}`);
      const body = await res.json();
      if (res.ok) {
        const values = Array.isArray(body.shipmentNumbers)
          ? body.shipmentNumbers.map(String)
          : [];
        setShipmentSuggestions((prev) => ({ ...prev, [key]: values }));
      }
    } catch {
      // ignore suggestion errors
    }
  };

  const addToWatchlist = async (row: SearchRow, shipmentReference?: string) => {
    const normalized = row.vessel_name_normalized;

    setAdding((prev) => ({ ...prev, [normalized]: true }));
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vesselName: row.vessel_name,
          shipmentReference: shipmentReference?.trim() || null,
        }),
      });
      const body = await res.json();

      if (res.ok || res.status === 409) {
        setWatchedSet((prev) => new Set(prev).add(normalized));

        const savedShipmentValues = parseShipmentValues(
          typeof body?.watch?.shipment_reference === 'string'
            ? body.watch.shipment_reference
            : shipmentReference
        );

        if (savedShipmentValues.length > 0) {
          setShipmentByVessel((prev) => {
            const existing = prev[normalized] ?? [];
            const merged = Array.from(new Set([...existing, ...savedShipmentValues]));
            if (merged.length === existing.length) return prev;
            return { ...prev, [normalized]: merged };
          });
        }

        setFlash(
          body?.updatedExisting
            ? `Watchlist-Eintrag für "${row.vessel_name}" aktualisiert.`
            : `"${row.vessel_name}" wurde zur Watchlist gespeichert.`
        );
      } else {
        setFlash(body?.error || 'Konnte Watchlist-Eintrag nicht erstellen.');
      }
    } catch {
      setFlash('Netzwerkfehler beim Speichern in der Watchlist.');
    } finally {
      setAdding((prev) => ({ ...prev, [normalized]: false }));
    }
  };


  const bulkAssignFromFilter = async () => {
    const value = snrFilter.trim();
    if (!value) {
      setFlash('Bitte zuerst eine S-Nr. im Filterfeld eingeben.');
      return;
    }

    const rowsToAssign = filteredRows.filter((row) => {
      const assigned = shipmentByVessel[row.vessel_name_normalized] ?? [];
      return !assigned.includes(value);
    });

    if (rowsToAssign.length === 0) {
      setFlash('Alle sichtbaren Schiffe haben diese S-Nr. bereits.');
      return;
    }

    const cappedRows = rowsToAssign.slice(0, 20);
    for (const row of cappedRows) {
      await addToWatchlist(row, value);
    }

    setFlash(
      `S-Nr. ${value} wurde ${cappedRows.length} sichtbaren Schiffen zugeordnet.` +
        (rowsToAssign.length > cappedRows.length ? ' (auf 20 Schiffe begrenzt)' : '')
    );
  };
  return (
    <div style={styles.wrap}>
      <div style={styles.headerRow}>
        <div style={styles.metaText}>
          Zeilen auf dieser Seite: {filteredRows.length} | Eindeutige Vessels: {uniqueVesselsOnPage}
        </div>
        <div style={styles.filterRow}>
          <input
            type="text"
            value={snrFilter}
            onChange={(e) => setSnrFilter(e.target.value)}
            placeholder="Suche nach S-Nr."
            style={styles.input}
          />
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={onlyUnassigned}
              onChange={(e) => {
                const next = e.target.checked;
                setOnlyUnassigned(next);
                if (next) setOnlyWithSnr(false);
              }}
            />
            Nur ohne S-Nr.
          </label>
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={onlyWithSnr}
              onChange={(e) => {
                const next = e.target.checked;
                setOnlyWithSnr(next);
                if (next) setOnlyUnassigned(false);
              }}
            />
            Nur mit S-Nr.
          </label>
          <button type="button" style={styles.bulkBtn} onClick={bulkAssignFromFilter}>
            Filter-S-Nr. zuordnen
          </button>
          {flash && <div style={styles.flash}>{flash}</div>}
        </div>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Vessel</th>
              <th style={styles.th}>Quelle</th>
              <th style={styles.th}>Neues ETA</th>
              <th style={styles.th}>Letztes ETA</th>
              <th style={styles.th}>Δ seit letztem Scrape</th>
              <th style={styles.th}>ETD</th>
              <th style={styles.th}>Terminal</th>
              <th style={styles.th}>Scraped At</th>
              <th style={styles.th}>S-Nr. (Watchlist)</th>
              <th style={styles.th}>Container</th>
              <th style={styles.th}>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Keine Daten gefunden
                </td>
              </tr>
            ) : (
              filteredRows.map((row, i) => {
                const key = row.vessel_name_normalized;
                const isWatched = watchedSet.has(key);
                const isAdding = adding[key] === true;
                const isOpen = menuOpenFor === key;
                const currentInput = shipmentInput[key] ?? '';
                const suggestions = shipmentSuggestions[key] ?? [];
                const assigned = shipmentByVessel[key] ?? [];
                const containers = containerByVessel[key] ?? [];

                return (
                  <tr key={`${row.vessel_name}-${row.source}-${row.scraped_at}-${i}`}>
                    <td style={styles.td}>{row.vessel_name}</td>
                    <td style={styles.td}>{row.source}</td>
                    <td style={styles.td}>{formatDateTime(row.eta)}</td>
                    <td style={styles.td}>{formatDateTime(row.previous_eta)}</td>
                    <td style={styles.td}>{formatEtaChange(row.eta_change_days)}</td>
                    <td style={styles.td}>{formatDateTime(row.etd)}</td>
                    <td style={styles.td}>{row.terminal ?? '-'}</td>
                    <td style={styles.td}>{formatDateTime(row.scraped_at)}</td>
                    <td style={styles.td}>{assigned.length > 0 ? assigned.join(', ') : '-'}</td>
                    <td style={styles.td}>{containers.length > 0 ? containers.join(', ') : '-'}</td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        onClick={() => setMenuOpenFor(isOpen ? null : key)}
                        style={styles.btnMenu}
                      >
                        {isOpen ? 'Menü schließen' : 'S-Nr. zuordnen'}
                      </button>

                      {assigned.length > 0 && (
                        <div style={styles.assignedText}>S-Nr.: {assigned.join(', ')}</div>
                      )}

                      {isOpen && (
                        <div style={styles.menuBox}>
                          <input
                            type="text"
                            value={currentInput}
                            onChange={(e) => {
                              const value = e.target.value;
                              setShipmentInput((prev) => ({ ...prev, [key]: value }));
                              fetchShipmentSuggestions(key, value);
                            }}
                            placeholder="S-Nr. eingeben oder suchen"
                            style={styles.menuInput}
                          />
                          {suggestions.length > 0 && (
                            <div style={styles.suggestionBox}>
                              {suggestions.map((snr) => (
                                <button
                                  key={`${key}-${snr}`}
                                  type="button"
                                  onClick={() =>
                                    setShipmentInput((prev) => ({ ...prev, [key]: snr }))
                                  }
                                  style={styles.suggestionItem}
                                >
                                  {snr}
                                </button>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => addToWatchlist(row, currentInput)}
                            disabled={isAdding}
                            style={{
                              ...styles.btnWatch,
                              backgroundColor: isWatched ? '#e2e8f0' : '#dcfce7',
                              color: isWatched ? '#475569' : '#166534',
                            }}
                          >
                            {isAdding
                              ? 'Speichere...'
                              : isWatched
                                ? 'Watchlist aktualisieren'
                                : 'Zur Watchlist speichern'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    marginTop: '8px',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '8px',
    flexWrap: 'wrap',
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  input: {
    padding: '8px 10px',
    border: '1px solid var(--border-strong)',
    borderRadius: '8px',
    fontSize: '13px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text-primary)',
  },
  metaText: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
  },
  checkLabel: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  bulkBtn: {
    border: '1px solid #bbf7d0',
    backgroundColor: '#f0fdf4',
    color: '#166534',
    borderRadius: '8px',
    padding: '7px 10px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  flash: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    maxWidth: '300px',
  },
  tableWrap: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    border: '1px solid var(--border)',
    overflow: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    padding: '12px 14px',
    textAlign: 'left',
    fontSize: '13px',
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    fontSize: '14px',
    verticalAlign: 'top',
  },
  btnMenu: {
    border: '1px solid var(--border-strong)',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 700,
    padding: '6px 10px',
    backgroundColor: 'var(--surface-muted)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
  },
  menuBox: {
    marginTop: '8px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '8px',
    backgroundColor: 'var(--surface-muted)',
    minWidth: '220px',
  },
  menuInput: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid var(--border-strong)',
    borderRadius: '6px',
    fontSize: '13px',
    boxSizing: 'border-box',
    backgroundColor: 'var(--surface)',
    color: 'var(--text-primary)',
  },
  suggestionBox: {
    marginTop: '6px',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    overflow: 'hidden',
    backgroundColor: 'var(--surface)',
  },
  suggestionItem: {
    width: '100%',
    textAlign: 'left',
    padding: '6px 8px',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    backgroundColor: 'var(--surface)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: '13px',
  },
  assignedText: {
    marginTop: '6px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    maxWidth: '240px',
  },
  btnWatch: {
    marginTop: '8px',
    width: '100%',
    border: '1px solid #bbf7d0',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 700,
    padding: '7px 10px',
    cursor: 'pointer',
  },
};
