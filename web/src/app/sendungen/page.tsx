'use client';

import { useEffect, useState, type CSSProperties } from 'react';

interface Sendung {
  id: string;
  vessel_name: string;
  shipment_reference: string | null;
  container_reference: string | null;
  last_known_eta: string | null;
  created_at: string;
}

export default function SendungenPage() {
  const [sendungen, setSendungen] = useState<Sendung[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/watchlist')
      .then((res) => res.json())
      .then((json) => {
        if (!json.watches) throw new Error(json.error || 'Fehler beim Laden');
        const withContainer = (json.watches as Sendung[]).filter(
          (w) => w.container_reference && w.container_reference.trim() !== ''
        );
        setSendungen(withContainer);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden');
      })
      .finally(() => setLoading(false));
  }, []);

  const formatEta = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('de-DE', {
      timeZone: 'Europe/Berlin',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Sendungen mit Container</h1>
      <p style={styles.subtitle}>
        Alle Watchlist-Einträge mit zugeordneter Container-Nummer.
      </p>

      {error && <div style={styles.error}>{error}</div>}
      {loading && <p style={styles.loadingText}>Sendungen werden geladen...</p>}

      {!loading && sendungen.length === 0 && !error && (
        <div style={styles.empty}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Noch keine Sendungen mit Container
          </p>
          <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)' }}>
            Lade eine Excel-Datei mit Container-Spalte hoch, um Container zuzuordnen.
          </p>
        </div>
      )}

      {!loading && sendungen.length > 0 && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>S-Nr.</th>
                <th style={styles.th}>Container</th>
                <th style={styles.th}>Vessel</th>
                <th style={styles.th}>ETA</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {sendungen.map((s) => (
                <tr key={s.id}>
                  <td style={styles.td}>{s.shipment_reference || '-'}</td>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{s.container_reference}</td>
                  <td style={styles.td}>{s.vessel_name}</td>
                  <td style={styles.td}>{formatEta(s.last_known_eta)}</td>
                  <td style={styles.td}>
                    <button type="button" style={styles.btnDelete} onClick={() => {}}>
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    maxWidth: '1100px',
    margin: '0 auto',
    padding: '32px 24px',
  },
  pageTitle: {
    fontSize: '24px',
    fontWeight: 700,
    margin: '0 0 8px',
    color: 'var(--text-primary)',
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    margin: '0 0 24px',
  },
  error: {
    padding: '12px 16px',
    backgroundColor: 'var(--surface-muted)',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    color: '#ef4444',
    fontSize: '14px',
    marginBottom: '16px',
  },
  loadingText: {
    textAlign: 'center',
    color: 'var(--text-secondary)',
    padding: '32px',
  },
  empty: {
    padding: '40px 24px',
    borderRadius: '12px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface)',
    textAlign: 'center',
    color: 'var(--text-primary)',
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
    color: 'var(--text-primary)',
  },
  btnDelete: {
    padding: '4px 12px',
    backgroundColor: 'var(--surface-muted)',
    color: '#ef4444',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '13px',
    cursor: 'pointer',
  },
};
