'use client';

import { useState, useEffect, type CSSProperties } from 'react';

interface ScraperRun {
  id: string;
  status: 'running' | 'success' | 'failed';
  vessels_scraped: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  errors: string | null;
}

export default function AdminDashboardPage() {
  const [lastRun, setLastRun] = useState<ScraperRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    fetchLastRun();
  }, []);

  const fetchLastRun = async () => {
    try {
      const res = await fetch('/api/admin/trigger-scraper');
      if (res.ok) {
        const data = await res.json();
        setLastRun(data.last_run);
      }
    } catch {
      // ignore
    }
  };

  const handleTriggerScraper = async () => {
    if (
      !confirm(
        'Scraper jetzt starten? Aktuelle ETAs werden von Eurogate und HHLA abgerufen.'
      )
    )
      return;

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch('/api/admin/trigger-scraper', {
        method: 'POST',
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setMessage({
          type: 'success',
          text:
            data.message ||
            `Scraper erfolgreich. ${data.vessels_scraped} Vessels gescraped.`,
        });
        fetchLastRun();
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Scraper fehlgeschlagen',
        });
        fetchLastRun();
      }
    } catch {
      setMessage({ type: 'error', text: 'Netzwerkfehler beim Starten' });
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return `${minutes}m ${rem}s`;
  };

  const statusColor: Record<string, { bg: string; fg: string; border: string }> = {
    success: { bg: '#f0fdf4', fg: '#15803d', border: '#bbf7d0' },
    failed: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
    running: { bg: '#fffbeb', fg: '#92400e', border: '#fde68a' },
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Admin Dashboard</h1>

      {/* Scraper Control */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Scraper Control</h2>
        <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#666' }}>
          Python-Scraper manuell starten (Eurogate + HHLA ETAs abrufen).
        </p>

        <button
          onClick={handleTriggerScraper}
          disabled={loading}
          style={{
            ...styles.btnPrimary,
            backgroundColor: loading ? '#93c5fd' : '#0066cc',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Scraper läuft...' : 'Scraper jetzt starten'}
        </button>

        {message && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px 16px',
              borderRadius: '8px',
              backgroundColor:
                message.type === 'success' ? '#f0fdf4' : '#fef2f2',
              color: message.type === 'success' ? '#15803d' : '#b91c1c',
              border: `1px solid ${message.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
              fontSize: '14px',
            }}
          >
            {message.text}
          </div>
        )}

        {/* Last Run */}
        {lastRun && (
          <div style={styles.lastRunBox}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600 }}>
              Letzter Scraper-Lauf
            </h3>
            <div style={styles.runGrid}>
              <div>
                <span style={styles.runLabel}>Status:</span>{' '}
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 600,
                    backgroundColor: statusColor[lastRun.status]?.bg ?? '#f3f4f6',
                    color: statusColor[lastRun.status]?.fg ?? '#333',
                    border: `1px solid ${statusColor[lastRun.status]?.border ?? '#d1d5db'}`,
                  }}
                >
                  {lastRun.status}
                </span>
              </div>
              <div>
                <span style={styles.runLabel}>Vessels:</span>{' '}
                <strong>{lastRun.vessels_scraped}</strong>
              </div>
              <div>
                <span style={styles.runLabel}>Gestartet:</span>{' '}
                {new Date(lastRun.started_at).toLocaleString('de-DE', {
                  timeZone: 'Europe/Berlin',
                })}
              </div>
              <div>
                <span style={styles.runLabel}>Dauer:</span>{' '}
                {formatDuration(lastRun.duration_ms)}
              </div>
            </div>
            {lastRun.errors && (
              <pre style={styles.errorPre}>{lastRun.errors}</pre>
            )}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <h2 style={{ ...styles.sectionTitle, marginTop: '32px' }}>
        Schnellzugriff
      </h2>
      <div style={styles.linkGrid}>
        <a href="/admin/users" style={styles.linkCard}>
          <div style={styles.linkTitle}>Benutzerverwaltung</div>
          <div style={styles.linkDesc}>
            Benutzer erstellen, bearbeiten und löschen
          </div>
        </a>
        <a href="/dashboard" style={styles.linkCard}>
          <div style={styles.linkTitle}>Dashboard</div>
          <div style={styles.linkDesc}>
            Statistiken und Upload-Verlauf anzeigen
          </div>
        </a>
        <a href="/eta-updater" style={styles.linkCard}>
          <div style={styles.linkTitle}>ETA Updater</div>
          <div style={styles.linkDesc}>Excel hochladen und verarbeiten</div>
        </a>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    padding: '32px 24px',
    maxWidth: '1000px',
    margin: '0 auto',
  },
  pageTitle: {
    margin: '0 0 24px',
    fontSize: '24px',
    fontWeight: 700,
  },
  sectionTitle: {
    margin: '0 0 12px',
    fontSize: '18px',
    fontWeight: 600,
  },
  card: {
    backgroundColor: '#fff',
    padding: '28px',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  btnPrimary: {
    padding: '12px 24px',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: 600,
  },
  lastRunBox: {
    marginTop: '24px',
    padding: '16px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },
  runGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '10px',
    fontSize: '14px',
  },
  runLabel: {
    color: '#666',
  },
  errorPre: {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: '#fff',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#b91c1c',
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '200px',
    overflow: 'auto',
  },
  linkGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '16px',
  },
  linkCard: {
    display: 'block',
    padding: '24px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    textDecoration: 'none',
    color: '#1a1a2e',
    border: '1px solid #e5e7eb',
  },
  linkTitle: {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '6px',
  },
  linkDesc: {
    fontSize: '13px',
    color: '#666',
  },
};
