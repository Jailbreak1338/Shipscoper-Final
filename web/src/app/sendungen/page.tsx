'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

interface ContainerRow {
  watch_id: string;
  vessel_name: string;
  shipment_reference: string | null;
  container_source: string | null;
  eta: string | null;
  etd: string | null;
  previous_eta: string | null;
  previous_etd: string | null;
  eta_change_days: number | null;
  etd_change_days: number | null;
  vessel_terminal: string | null;
  container_no: string;
  terminal: string | null;
  provider: string | null;
  normalized_status: string | null;
  status_raw: string | null;
  scraped_at: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  PREANNOUNCED: 'Avisiert',
  DISCHARGED: 'Entladen',
  READY: 'Bereit',
  DELIVERED_OUT: 'Ausgeliefert',
};
const STATUS_COLORS: Record<string, string> = {
  PREANNOUNCED: '#6b7280',
  DISCHARGED: '#d97706',
  READY: '#2563eb',
  DELIVERED_OUT: '#16a34a',
};

function fmtDate(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
function fmtTs(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function fmtDayDiff(days: number | null): string {
  if (days == null || days === 0) return '';
  return `${days > 0 ? '+' : ''}${days}d`;
}

export default function SendungenPage() {
  const [rows, setRows] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState('');
  const [checkLog, setCheckLog] = useState('');

  const loadData = useCallback(() => {
    setLoading(true);
    setError('');
    fetch('/api/sendungen')
      .then((r) => r.json())
      .then((json) => {
        if (!json.sendungen) throw new Error(json.error || 'Fehler beim Laden');
        setRows(json.sendungen as ContainerRow[]);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Fehler'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const stats = useMemo(() => {
    const total = rows.length;
    const withStatus = rows.filter((r) => r.normalized_status).length;
    const ready = rows.filter((r) => r.normalized_status === 'READY').length;
    const delivered = rows.filter((r) => r.normalized_status === 'DELIVERED_OUT').length;
    const discharged = rows.filter((r) => r.normalized_status === 'DISCHARGED').length;
    return { total, withStatus, ready, delivered, discharged };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesQuery =
        !q ||
        r.container_no.toLowerCase().includes(q) ||
        (r.shipment_reference ?? '').toLowerCase().includes(q) ||
        r.vessel_name.toLowerCase().includes(q) ||
        (r.terminal ?? r.vessel_terminal ?? '').toLowerCase().includes(q);
      const matchesStatus = !statusFilter || r.normalized_status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [rows, query, statusFilter]);

  const handleCheck = async () => {
    setChecking(true);
    setCheckMsg('Container-Status wird abgerufen…');
    setCheckLog('');
    try {
      const res = await fetch('/api/sendungen/check-container', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Fehler beim Starten');
      const jobId: string = json.jobId;
      const start = Date.now();
      while (Date.now() - start < 90_000) {
        await new Promise((r) => setTimeout(r, 5_000));
        const sr = await fetch(`/api/sendungen/check-container?jobId=${encodeURIComponent(jobId)}`);
        const sj = await sr.json();
        const st: string = sj.status ?? 'unknown';
        if (st === 'done') {
          setCheckMsg('Container-Status erfolgreich abgerufen.');
          setCheckLog(sj.stdout ?? '');
          loadData();
          break;
        } else if (st === 'failed' || st === 'error') {
          setCheckMsg('Fehler beim Abrufen.');
          setCheckLog(sj.stderr ?? sj.stdout ?? sj.error ?? '');
          break;
        }
      }
    } catch (e: unknown) {
      setCheckMsg(e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.title}>Sendungen</h1>
          <p style={styles.subtitle}>Container-Tracking · eine Zeile pro S-Nr. · Terminal und Status aus Live-Abfrage</p>
        </div>
        <button
          type="button"
          style={{ ...styles.btnPrimary, opacity: checking ? 0.7 : 1, cursor: checking ? 'default' : 'pointer' }}
          onClick={handleCheck}
          disabled={checking}
        >
          {checking ? 'Wird abgerufen…' : 'Container-Status abrufen'}
        </button>
      </div>

      {/* Stats */}
      {!loading && rows.length > 0 && (
        <div style={styles.statsRow}>
          <StatCard label="Sendungen gesamt" value={stats.total} />
          <StatCard label="Mit Status" value={stats.withStatus} />
          <StatCard label="Bereit" value={stats.ready} color="#2563eb" />
          <StatCard label="Entladen" value={stats.discharged} color="#d97706" />
          <StatCard label="Ausgeliefert" value={stats.delivered} color="#16a34a" />
        </div>
      )}

      {/* Check-Feedback */}
      {checkMsg && (
        <div style={{ ...styles.infoBox, borderColor: checkMsg.startsWith('Fehler') ? '#fecaca' : '#bbf7d0' }}>
          <strong>{checkMsg}</strong>
          {checkLog && <pre style={styles.logPre}>{checkLog}</pre>}
        </div>
      )}
      {error && <div style={styles.errorBox}>{error}</div>}

      {/* Search & Filter */}
      <div style={styles.filterRow}>
        <input
          type="search"
          placeholder="Suche nach S-Nr., Container, Schiff, Terminal …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.searchInput}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          title="Status filtern"
          style={styles.select}
        >
          <option value="">Alle Status</option>
          <option value="PREANNOUNCED">Avisiert</option>
          <option value="DISCHARGED">Entladen</option>
          <option value="READY">Bereit</option>
          <option value="DELIVERED_OUT">Ausgeliefert</option>
        </select>
        {(query || statusFilter) && (
          <button
            type="button"
            style={styles.btnReset}
            onClick={() => { setQuery(''); setStatusFilter(''); }}
          >
            Zurücksetzen
          </button>
        )}
        <span style={styles.resultCount}>{filtered.length} / {rows.length} Einträge</span>
      </div>

      {/* Table */}
      {loading && <p style={styles.loadingText}>Sendungen werden geladen…</p>}

      {!loading && rows.length === 0 && !error && (
        <div style={styles.empty}>
          <p style={{ margin: 0, fontWeight: 600 }}>Noch keine Sendungen mit Container</p>
          <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
            Lade eine Excel-Datei mit Container-Spalte hoch, um Container zuzuordnen.
          </p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>S-Nr.</th>
                <th style={styles.th}>Container</th>
                <th style={styles.th}>Schiff</th>
                <th style={styles.th}>ETA</th>
                <th style={styles.th}>Δ ETA</th>
                <th style={styles.th}>ETD</th>
                <th style={styles.th}>Δ ETD</th>
                <th style={styles.th}>Terminal</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Abgerufen</th>
                <th style={styles.th}>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-secondary)', padding: '32px' }}>
                    Keine Treffer für die aktuelle Suche.
                  </td>
                </tr>
              ) : (
                filtered.map((row, i) => {
                  const displayTerminal = row.terminal ?? row.vessel_terminal ?? null;
                  const etaDelta = fmtDayDiff(row.eta_change_days);
                  const etdDelta = fmtDayDiff(row.etd_change_days);
                  return (
                    <tr key={`${row.watch_id}::${row.container_no}::${row.shipment_reference ?? i}`}>
                      <td style={styles.td}>
                        {row.shipment_reference
                          ? <span style={styles.snrBadge}>{row.shipment_reference}</span>
                          : <span style={{ color: 'var(--text-secondary)' }}>–</span>}
                      </td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontWeight: 600, fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {row.container_no}
                      </td>
                      <td style={styles.td}>{row.vessel_name}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{fmtDate(row.eta)}</td>
                      <td style={{ ...styles.td, fontWeight: 600, whiteSpace: 'nowrap', color: row.eta_change_days == null || row.eta_change_days === 0 ? 'var(--text-secondary)' : row.eta_change_days > 0 ? '#dc2626' : '#16a34a' }}>
                        {etaDelta || '–'}
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{fmtDate(row.etd)}</td>
                      <td style={{ ...styles.td, fontWeight: 600, whiteSpace: 'nowrap', color: row.etd_change_days == null || row.etd_change_days === 0 ? 'var(--text-secondary)' : row.etd_change_days > 0 ? '#dc2626' : '#16a34a' }}>
                        {etdDelta || '–'}
                      </td>
                      <td style={styles.td}>
                        {displayTerminal
                          ? <span style={styles.terminalBadge}>{displayTerminal}</span>
                          : <span style={{ color: 'var(--text-secondary)' }}>–</span>}
                      </td>
                      <td style={styles.td}>
                        <StatusBadge status={row.normalized_status} raw={row.status_raw} />
                      </td>
                      <td style={{ ...styles.td, fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {fmtTs(row.scraped_at)}
                      </td>
                      <td style={styles.td}>
                        <div style={styles.actionGroup}>
                          <button type="button" style={styles.btnNotify} onClick={() => {}}>
                            Lösch-Benachrichtigung
                          </button>
                          <button type="button" style={styles.btnPickup} onClick={() => {}}>
                            Abnahme-Benachrichtigung
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statValue, color: color ?? 'var(--text-primary)' }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function StatusBadge({ status, raw }: { status: string | null; raw: string | null }) {
  if (!status) return <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Noch nicht abgerufen</span>;
  const label = STATUS_LABELS[status] ?? status;
  const color = STATUS_COLORS[status] ?? '#6b7280';
  return (
    <div>
      <span style={{ display: 'inline-block', padding: '2px 7px', border: `1px solid ${color}40`, borderRadius: '4px', fontSize: '11px', fontWeight: 600, color, backgroundColor: `${color}12` }}>
        {label}
      </span>
      {raw && raw !== status && (
        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>{raw}</div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: '1500px', margin: '0 auto', padding: '32px 24px' },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' },
  title: { fontSize: '24px', fontWeight: 700, margin: '0 0 4px', color: 'var(--text-primary)' },
  subtitle: { fontSize: '13px', color: 'var(--text-secondary)', margin: 0 },
  btnPrimary: { padding: '9px 16px', backgroundColor: '#0066cc', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, flexShrink: 0 },
  statsRow: { display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' },
  statCard: { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 20px', minWidth: '110px', textAlign: 'center' },
  statValue: { fontSize: '26px', fontWeight: 700 },
  statLabel: { fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px', textTransform: 'uppercase', letterSpacing: '0.04em' },
  infoBox: { padding: '12px 16px', backgroundColor: 'var(--surface)', border: '1px solid', borderRadius: '8px', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '12px' },
  logPre: { marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '140px', overflowY: 'auto', background: 'var(--surface-muted)', padding: '8px', borderRadius: '4px' },
  errorBox: { padding: '12px 16px', backgroundColor: 'var(--surface-muted)', border: '1px solid #fecaca', borderRadius: '8px', color: '#ef4444', fontSize: '14px', marginBottom: '12px' },
  filterRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' },
  searchInput: { flex: '1 1 260px', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '14px', backgroundColor: 'var(--surface)', color: 'var(--text-primary)', outline: 'none', minWidth: '200px' },
  select: { padding: '9px 10px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '14px', backgroundColor: 'var(--surface)', color: 'var(--text-primary)', cursor: 'pointer' },
  btnReset: { padding: '9px 12px', backgroundColor: 'var(--surface-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' },
  resultCount: { fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' },
  loadingText: { textAlign: 'center', color: 'var(--text-secondary)', padding: '32px' },
  empty: { padding: '48px 24px', borderRadius: '12px', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', textAlign: 'center', color: 'var(--text-primary)' },
  tableWrap: { backgroundColor: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)', overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '11px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em' },
  td: { padding: '9px 12px', borderBottom: '1px solid var(--border)', fontSize: '13px', verticalAlign: 'middle', color: 'var(--text-primary)' },
  snrBadge: { display: 'inline-block', padding: '2px 7px', backgroundColor: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '11px', fontWeight: 700, fontFamily: 'monospace' },
  terminalBadge: { display: 'inline-block', padding: '2px 7px', backgroundColor: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '11px', fontWeight: 600 },
  actionGroup: { display: 'flex', flexDirection: 'column', gap: '4px' },
  btnNotify: { padding: '4px 8px', backgroundColor: 'var(--surface-muted)', color: '#92400e', border: '1px solid #fde68a', borderRadius: '5px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  btnPickup: { padding: '4px 8px', backgroundColor: 'var(--surface-muted)', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: '5px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
};
