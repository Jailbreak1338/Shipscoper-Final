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
};

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
  });
}

export default function ScheduleSearchTable({
  rows,
  initiallyWatched,
}: {
  rows: SearchRow[];
  initiallyWatched: string[];
}) {
  const [watchedSet, setWatchedSet] = useState<Set<string>>(
    () => new Set(initiallyWatched)
  );
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState('');

  const uniqueVesselsOnPage = useMemo(() => {
    const names = new Set(rows.map((r) => r.vessel_name_normalized));
    return names.size;
  }, [rows]);

  const addToWatchlist = async (row: SearchRow) => {
    const normalized = row.vessel_name_normalized;
    if (watchedSet.has(normalized)) return;

    setAdding((prev) => ({ ...prev, [normalized]: true }));
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vesselName: row.vessel_name }),
      });
      const body = await res.json();

      if (res.ok || res.status === 409) {
        setWatchedSet((prev) => new Set(prev).add(normalized));
        setFlash(res.status === 409 ? 'Bereits auf der Watchlist.' : `"${row.vessel_name}" wurde zur Watchlist hinzugefuegt.`);
      } else {
        setFlash(body?.error || 'Konnte Watchlist-Eintrag nicht erstellen.');
      }
    } catch {
      setFlash('Netzwerkfehler beim Speichern in der Watchlist.');
    } finally {
      setAdding((prev) => ({ ...prev, [normalized]: false }));
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.headerRow}>
        <div style={styles.metaText}>
          Zeilen auf dieser Seite: {rows.length} | Eindeutige Vessels: {uniqueVesselsOnPage}
        </div>
        {flash && <div style={styles.flash}>{flash}</div>}
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Vessel</th>
              <th style={styles.th}>Quelle</th>
              <th style={styles.th}>ETA</th>
              <th style={styles.th}>ETD</th>
              <th style={styles.th}>Terminal</th>
              <th style={styles.th}>Scraped At</th>
              <th style={styles.th}>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#777' }}>
                  Keine Daten gefunden
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const isWatched = watchedSet.has(row.vessel_name_normalized);
                const isAdding = adding[row.vessel_name_normalized] === true;
                return (
                  <tr key={`${row.vessel_name}-${row.source}-${row.scraped_at}-${i}`}>
                    <td style={styles.td}>{row.vessel_name}</td>
                    <td style={styles.td}>{row.source}</td>
                    <td style={styles.td}>{formatDateTime(row.eta)}</td>
                    <td style={styles.td}>{formatDateTime(row.etd)}</td>
                    <td style={styles.td}>{row.terminal ?? '-'}</td>
                    <td style={styles.td}>{formatDateTime(row.scraped_at)}</td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        onClick={() => addToWatchlist(row)}
                        disabled={isWatched || isAdding}
                        style={{
                          ...styles.btnWatch,
                          backgroundColor: isWatched ? '#e2e8f0' : '#dcfce7',
                          color: isWatched ? '#64748b' : '#166534',
                          cursor: isWatched || isAdding ? 'default' : 'pointer',
                        }}
                      >
                        {isAdding ? 'Speichere...' : isWatched ? 'In Watchlist' : 'Zur Watchlist'}
                      </button>
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
  metaText: {
    fontSize: '13px',
    color: '#64748b',
  },
  flash: {
    fontSize: '13px',
    color: '#155e75',
    backgroundColor: '#ecfeff',
    border: '1px solid #a5f3fc',
    borderRadius: '8px',
    padding: '6px 10px',
  },
  tableWrap: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
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
    color: '#666',
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 14px',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '14px',
    whiteSpace: 'nowrap',
  },
  btnWatch: {
    border: '1px solid #bbf7d0',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 700,
    padding: '6px 10px',
  },
};
