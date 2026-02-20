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
  initialSnrFilter,
}: {
  rows: SearchRow[];
  initialShipmentByVessel: ShipmentMap;
  initialSnrFilter?: string;
}) {
  const [shipmentByVessel] = useState<ShipmentMap>(initialShipmentByVessel);
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
              <th style={styles.th}>S-Nr. (aus Upload)</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Keine Daten gefunden
                </td>
              </tr>
            ) : (
              filteredRows.map((row, i) => {
                const key = row.vessel_name_normalized;
                const assigned = shipmentByVessel[key] ?? [];

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
};
