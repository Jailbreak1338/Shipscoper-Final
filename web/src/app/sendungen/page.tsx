'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

interface ContainerRow {
  watch_id: string;
  vessel_name: string;
  shipment_reference: string | null;
  container_source: string | null;
  eta: string | null;
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

function formatEta(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatTs(iso: string | null) {
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

function TerminalBadge({ terminal, provider }: { terminal: string | null; provider: string | null }) {
  if (!terminal && !provider) return <span style={{ color: 'var(--text-secondary)' }}>-</span>;
  const label = terminal ?? '?';
  const providerLabel = provider === 'hhla' ? 'HHLA' : provider === 'eurogate' ? 'Eurogate' : (provider?.toUpperCase() ?? '');
  return (
    <span style={styles.terminalBadge}>
      {label}
      {providerLabel && <span style={styles.terminalProvider}> · {providerLabel}</span>}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Noch nicht abgerufen</span>;
  const label = STATUS_LABELS[status] ?? status;
  const color = STATUS_COLORS[status] ?? '#6b7280';
  return (
    <span style={{ ...styles.statusBadge, color, borderColor: color + '40', backgroundColor: color + '12' }}>
      {label}
    </span>
  );
}

export default function SendungenPage() {
  const [rows, setRows] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState('');
  const [checkLog, setCheckLog] = useState('');

  const loadData = useCallback(() => {
    setLoading(true);
    setError('');
    fetch('/api/sendungen')
      .then((res) => res.json())
      .then((json) => {
        if (!json.sendungen) throw new Error(json.error || 'Fehler beim Laden');
        setRows(json.sendungen as ContainerRow[]);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Fehler beim Laden'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCheckContainers = async () => {
    setChecking(true);
    setCheckMsg('Container-Status wird abgerufen...');
    setCheckLog('');

    try {
      const res = await fetch('/api/sendungen/check-container', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Fehler beim Starten');

      const jobId: string = json.jobId;

      // Poll until done (max 90s)
      const start = Date.now();
      while (Date.now() - start < 90_000) {
        await new Promise((r) => setTimeout(r, 5_000));
        const statusRes = await fetch(`/api/sendungen/check-container?jobId=${encodeURIComponent(jobId)}`);
        const statusJson = await statusRes.json();
        const status: string = statusJson.status ?? 'unknown';

        if (status === 'done') {
          setCheckMsg('Container-Status erfolgreich abgerufen.');
          setCheckLog(statusJson.stdout ?? '');
          loadData();
          break;
        } else if (status === 'failed' || status === 'error') {
          setCheckMsg('Fehler beim Abrufen.');
          setCheckLog(statusJson.stderr ?? statusJson.stdout ?? statusJson.error ?? '');
          break;
        }
        // still running — keep polling
      }
    } catch (e: unknown) {
      setCheckMsg(e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>Sendungen mit Container</h1>
          <p style={styles.subtitle}>
            Nur Einträge mit gültiger ISO-6346-Container-Nummer.
          </p>
        </div>
        <button
          type="button"
          style={{ ...styles.btnCheck, opacity: checking ? 0.7 : 1, cursor: checking ? 'default' : 'pointer' }}
          onClick={handleCheckContainers}
          disabled={checking}
        >
          {checking ? 'Wird abgerufen...' : 'Alle Container-Status abrufen'}
        </button>
      </div>

      {checkMsg && (
        <div style={{ ...styles.infoBox, borderColor: checkMsg.startsWith('Fehler') ? '#fecaca' : '#bbf7d0' }}>
          <strong>{checkMsg}</strong>
          {checkLog && (
            <pre style={styles.logPre}>{checkLog}</pre>
          )}
        </div>
      )}

      {error && <div style={styles.errorBox}>{error}</div>}
      {loading && <p style={styles.loadingText}>Sendungen werden geladen...</p>}

      {!loading && rows.length === 0 && !error && (
        <div style={styles.empty}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Noch keine Sendungen mit Container</p>
          <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)' }}>
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
                <th style={styles.th}>Terminal</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Zuletzt abgerufen</th>
                <th style={styles.th}>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.watch_id}::${row.container_no}`}>
                  <td style={styles.td}>{row.shipment_reference || '-'}</td>
                  <td style={{ ...styles.td, fontFamily: 'monospace', fontWeight: 600, fontSize: '13px' }}>
                    {row.container_no}
                  </td>
                  <td style={styles.td}>{row.vessel_name}</td>
                  <td style={styles.td}>{formatEta(row.eta)}</td>
                  <td style={styles.td}>
                    <TerminalBadge terminal={row.terminal} provider={row.provider} />
                  </td>
                  <td style={styles.td}>
                    <StatusBadge status={row.normalized_status} />
                    {row.status_raw && row.status_raw !== row.normalized_status && (
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {row.status_raw}
                      </div>
                    )}
                  </td>
                  <td style={{ ...styles.td, fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {formatTs(row.scraped_at)}
                  </td>
                  <td style={styles.td}>
                    <div style={styles.btnGroup}>
                      <button type="button" style={styles.btnNotify} onClick={() => {}}>
                        Container-Lösch-Benachrichtigung
                      </button>
                      <button type="button" style={styles.btnWatchlist} onClick={() => {}}>
                        Zur Watchlist hinzufügen
                      </button>
                    </div>
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
    maxWidth: '1300px',
    margin: '0 auto',
    padding: '32px 24px',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
    marginBottom: '24px',
    flexWrap: 'wrap',
  },
  pageTitle: {
    fontSize: '24px',
    fontWeight: 700,
    margin: '0 0 4px',
    color: 'var(--text-primary)',
  },
  subtitle: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    margin: 0,
  },
  btnCheck: {
    padding: '8px 16px',
    backgroundColor: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    flexShrink: 0,
  },
  infoBox: {
    padding: '12px 16px',
    backgroundColor: 'var(--surface)',
    border: '1px solid',
    borderRadius: '8px',
    fontSize: '13px',
    color: 'var(--text-primary)',
    marginBottom: '16px',
  },
  logPre: {
    marginTop: '8px',
    fontSize: '11px',
    color: 'var(--text-secondary)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: '160px',
    overflowY: 'auto',
    background: 'var(--surface-muted)',
    padding: '8px',
    borderRadius: '4px',
  },
  errorBox: {
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
    padding: '11px 13px',
    textAlign: 'left',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    fontWeight: 600,
  },
  td: {
    padding: '9px 13px',
    borderBottom: '1px solid var(--border)',
    fontSize: '13px',
    verticalAlign: 'top',
    color: 'var(--text-primary)',
  },
  terminalBadge: {
    display: 'inline-block',
    padding: '2px 7px',
    backgroundColor: 'var(--surface-muted)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  terminalProvider: {
    fontWeight: 400,
    color: 'var(--text-secondary)',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '2px 7px',
    border: '1px solid',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 600,
  },
  btnGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  btnNotify: {
    padding: '4px 9px',
    backgroundColor: 'var(--surface-muted)',
    color: '#b45309',
    border: '1px solid #fde68a',
    borderRadius: '6px',
    fontSize: '11px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnWatchlist: {
    padding: '4px 9px',
    backgroundColor: 'var(--surface-muted)',
    color: '#1d4ed8',
    border: '1px solid #bfdbfe',
    borderRadius: '6px',
    fontSize: '11px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
};
