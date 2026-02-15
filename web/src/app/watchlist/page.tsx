'use client';

import { useEffect, useState, type CSSProperties } from 'react';

interface Watch {
  id: string;
  vessel_name: string;
  vessel_name_normalized: string;
  shipment_reference: string | null;
  last_known_eta: string | null;
  notification_enabled: boolean;
  created_at: string;
  last_notified_at: string | null;
}

export default function WatchlistPage() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add form
  const [vesselName, setVesselName] = useState('');
  const [shipmentRef, setShipmentRef] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchWatches = async () => {
    try {
      const res = await fetch('/api/watchlist');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setWatches(json.watches);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load watchlist');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWatches();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vesselName.trim()) return;
    setAdding(true);
    setError('');

    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vesselName: vesselName.trim(),
          shipmentReference: shipmentRef.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setWatches((prev) => [json.watch, ...prev]);
      setVesselName('');
      setShipmentRef('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add vessel');
    } finally {
      setAdding(false);
    }
  };

  const handleToggleNotification = async (watch: Watch) => {
    try {
      const res = await fetch(`/api/watchlist/${watch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notification_enabled: !watch.notification_enabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setWatches((prev) =>
        prev.map((w) => (w.id === watch.id ? json.watch : w))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Vessel von der Watchlist entfernen?')) return;
    try {
      const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error);
      }
      setWatches((prev) => prev.filter((w) => w.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const formatEta = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('de-DE', {
      timeZone: 'Europe/Berlin',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
    });
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Vessel Watchlist</h1>
      <p style={styles.subtitle}>
        Vessels beobachten und bei ETA-Änderungen benachrichtigt werden.
      </p>

      {/* Add Form */}
      <form onSubmit={handleAdd} style={styles.form}>
        <div style={styles.formRow}>
          <input
            type="text"
            placeholder="Vessel Name (z.B. EVER GIVEN)"
            value={vesselName}
            onChange={(e) => setVesselName(e.target.value)}
            style={styles.input}
            required
          />
          <input
            type="text"
            placeholder="Sendungsnummer (optional)"
            value={shipmentRef}
            onChange={(e) => setShipmentRef(e.target.value)}
            style={{ ...styles.input, maxWidth: '220px' }}
          />
          <button type="submit" disabled={adding} style={styles.btnAdd}>
            {adding ? 'Wird hinzugefügt...' : 'Hinzufügen'}
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div style={styles.error}>
          {error}
          <button
            onClick={() => setError('')}
            style={styles.errorClose}
          >
            ×
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && <p style={styles.loadingText}>Watchlist wird geladen...</p>}

      {/* Empty state */}
      {!loading && watches.length === 0 && (
        <div style={styles.empty}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Noch keine Vessels auf der Watchlist
          </p>
          <p style={{ margin: '8px 0 0', color: '#666' }}>
            Füge oben ein Vessel hinzu, um bei ETA-Änderungen benachrichtigt zu
            werden.
          </p>
        </div>
      )}

      {/* Table */}
      {watches.length > 0 && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Vessel</th>
                <th style={styles.th}>Sendung</th>
                <th style={styles.th}>Letzte ETA</th>
                <th style={styles.th}>Benachrichtigung</th>
                <th style={styles.th}>Hinzugefügt</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {watches.map((watch) => (
                <tr key={watch.id}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>
                    {watch.vessel_name}
                  </td>
                  <td style={styles.td}>
                    {watch.shipment_reference || '—'}
                  </td>
                  <td style={styles.td}>{formatEta(watch.last_known_eta)}</td>
                  <td style={styles.td}>
                    <button
                      onClick={() => handleToggleNotification(watch)}
                      style={{
                        ...styles.btnToggle,
                        backgroundColor: watch.notification_enabled
                          ? '#dcfce7'
                          : '#f3f4f6',
                        color: watch.notification_enabled
                          ? '#15803d'
                          : '#888',
                      }}
                    >
                      {watch.notification_enabled ? 'Aktiv' : 'Aus'}
                    </button>
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      color: '#666',
                      fontSize: '13px',
                    }}
                  >
                    {formatDate(watch.created_at)}
                  </td>
                  <td style={styles.td}>
                    <button
                      onClick={() => handleDelete(watch.id)}
                      style={styles.btnDelete}
                    >
                      Entfernen
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
    padding: '32px 24px',
    maxWidth: '1100px',
    margin: '0 auto',
  },
  pageTitle: {
    margin: '0 0 4px',
    fontSize: '24px',
    fontWeight: 700,
  },
  subtitle: {
    margin: '0 0 24px',
    color: '#666',
    fontSize: '14px',
  },
  form: {
    marginBottom: '24px',
  },
  formRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap' as const,
  },
  input: {
    flex: 1,
    minWidth: '200px',
    padding: '10px 14px',
    fontSize: '14px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
  },
  btnAdd: {
    padding: '10px 20px',
    backgroundColor: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '14px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  error: {
    padding: '12px 16px',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    color: '#b91c1c',
    fontSize: '14px',
    marginBottom: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorClose: {
    background: 'none',
    border: 'none',
    color: '#b91c1c',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '0 4px',
  },
  loadingText: {
    textAlign: 'center' as const,
    color: '#666',
    padding: '32px',
  },
  empty: {
    textAlign: 'center' as const,
    padding: '48px 24px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  tableWrap: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    overflow: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left' as const,
    fontWeight: 600,
    fontSize: '13px',
    color: '#666',
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '12px 16px',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '14px',
  },
  btnToggle: {
    padding: '4px 12px',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnDelete: {
    padding: '4px 12px',
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '13px',
    cursor: 'pointer',
  },
};
