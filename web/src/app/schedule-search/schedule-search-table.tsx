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

export default function ScheduleSearchTable({
  rows,
  initialShipmentByVessel,
  initialContainerByVessel,
  initialSnrFilter,
}: {
  rows: SearchRow[];
  initialShipmentByVessel: ShipmentMap;
  initialContainerByVessel: ShipmentMap;
  initialSnrFilter?: string;
}) {
  const [shipmentByVessel] = useState<ShipmentMap>(initialShipmentByVessel);
  const [containerByVessel] = useState<ShipmentMap>(initialContainerByVessel);
  const [snrFilter, setSnrFilter] = useState(initialSnrFilter ?? '');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [onlyWithSnr, setOnlyWithSnr] = useState(false);

  const uniqueVesselsOnPage = useMemo(() => {
    return new Set(rows.map((r) => r.vessel_name_normalized)).size;
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

  return (
    <div style={styles.wrap}>
      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div style={styles.headerRow}>
        <div style={styles.metaText}>
          Zeilen: {filteredRows.length} · Schiffe: {uniqueVesselsOnPage}
        </div>
        <div style={styles.filterRow}>
          <input
            type="text"
            value={snrFilter}
            onChange={(e) => setSnrFilter(e.target.value)}
            placeholder="S-Nr. suchen …"
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
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Schiff</th>
              <th style={styles.th}>Quelle</th>
              <th style={styles.th}>ETA</th>
              <th style={styles.th}>Vorh. ETA</th>
              <th style={styles.th}>Δ ETA</th>
              <th style={styles.th}>ETD</th>
              <th style={styles.th}>Terminal</th>
              <th style={styles.th}>Abgerufen</th>
              <th style={styles.th}>S-Nr.</th>
              <th style={styles.th}>Container</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-secondary)', padding: '32px' }}>
                  Keine Daten gefunden
                </td>
              </tr>
            ) : (
              filteredRows.map((row, i) => {
                const key = row.vessel_name_normalized;
                const assigned = shipmentByVessel[key] ?? [];
                const containers = containerByVessel[key] ?? [];

                return (
                  <tr key={`${row.vessel_name}-${row.source}-${row.scraped_at}-${i}`}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{row.vessel_name}</td>
                    <td style={styles.td}>
                      <span style={{
                        ...styles.sourceBadge,
                        backgroundColor: row.source === 'eurogate' ? '#eff6ff' : '#f0fdf4',
                        color: row.source === 'eurogate' ? '#1d4ed8' : '#166534',
                        borderColor: row.source === 'eurogate' ? '#bfdbfe' : '#bbf7d0',
                      }}>
                        {row.source === 'eurogate' ? 'Eurogate' : 'HHLA'}
                      </span>
                    </td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDateTime(row.eta)}</td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{formatDateTime(row.previous_eta)}</td>
                    <td style={{
                      ...styles.td,
                      fontWeight: 600,
                      color: row.eta_change_days == null || row.eta_change_days === 0
                        ? 'var(--text-secondary)'
                        : row.eta_change_days > 0 ? '#dc2626' : '#16a34a',
                    }}>
                      {formatEtaChange(row.eta_change_days)}
                    </td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{formatDateTime(row.etd)}</td>
                    <td style={styles.td}>{row.terminal ?? '-'}</td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: '12px' }}>{formatDateTime(row.scraped_at)}</td>
                    <td style={styles.td}>
                      {assigned.length > 0
                        ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                            {assigned.map((snr) => (
                              <span key={snr} style={styles.snrBadge}>{snr}</span>
                            ))}
                          </div>
                        : <span style={{ color: 'var(--text-secondary)' }}>–</span>}
                    </td>
                    <td style={styles.td}>
                      {containers.length > 0
                        ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                            {containers.map((c) => (
                              <span key={c} style={styles.containerBadge}>{c}</span>
                            ))}
                          </div>
                        : <span style={{ color: 'var(--text-secondary)' }}>–</span>}
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
  wrap: { marginTop: '8px' },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '10px',
    flexWrap: 'wrap',
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  metaText: { fontSize: '13px', color: 'var(--text-secondary)' },
  input: {
    padding: '8px 12px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    fontSize: '14px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text-primary)',
  },
  checkLabel: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
  },
  tableWrap: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    border: '1px solid var(--border)',
    overflow: 'auto',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '12px 14px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  td: {
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    fontSize: '13px',
    verticalAlign: 'middle',
    color: 'var(--text-primary)',
  },
  sourceBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    border: '1px solid',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
  },
  snrBadge: {
    display: 'inline-block',
    padding: '2px 6px',
    backgroundColor: 'var(--surface-muted)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    fontFamily: 'monospace',
  },
  containerBadge: {
    display: 'inline-block',
    padding: '2px 6px',
    backgroundColor: 'var(--surface-muted)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    fontSize: '11px',
    fontFamily: 'monospace',
  },
};
