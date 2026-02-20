'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

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

interface VesselSuggestion {
  name: string;
  name_normalized: string;
}

export default function WatchlistPage() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [vesselName, setVesselName] = useState('');
  const [shipmentRef, setShipmentRef] = useState('');
  const [adding, setAdding] = useState(false);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [watchSearch, setWatchSearch] = useState('');

  const [suggestions, setSuggestions] = useState<VesselSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchWatches = async () => {
    try {
      const res = await fetch('/api/watchlist');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load watchlist');
      setWatches(json.watches ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load watchlist');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWatches();
  }, []);

  useEffect(() => {
    if (vesselName.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/vessels/search?q=${encodeURIComponent(vesselName.trim())}`);
        const json = await res.json();
        if (res.ok) {
          const vessels: VesselSuggestion[] = json.vessels ?? [];
          setSuggestions(vessels);
          setShowSuggestions(vessels.length > 0);
        }
      } catch {
        // Ignore autocomplete failures.
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [vesselName]);


  const filteredWatches = watches.filter((watch) => {
    const query = watchSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      watch.vessel_name.toLowerCase().includes(query) ||
      (watch.shipment_reference || '').toLowerCase().includes(query)
    );
  });

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
      if (!res.ok) throw new Error(json.error || 'Failed to add vessel');

      setWatches((prev) => {
        const idx = prev.findIndex((w) => w.id === json.watch.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = json.watch;
          return copy;
        }
        return [json.watch, ...prev];
      });
      setVesselName('');
      setShipmentRef('');
      setSuggestions([]);
      setShowSuggestions(false);
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
      if (!res.ok) throw new Error(json.error || 'Failed to update watch');
      setWatches((prev) => prev.map((w) => (w.id === watch.id ? json.watch : w)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update watch');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Vessel von der Watchlist entfernen?')) return;
    try {
      const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to delete watch');
      }
      setWatches((prev) => prev.filter((w) => w.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete watch');
    }
  };

  const handleSendTestEmail = async () => {
    setSendingTestEmail(true);
    setError('');
    try {
      const res = await fetch('/api/watchlist/test-email', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Test email failed');

      const target = typeof json.email === 'string' ? json.email : 'deine hinterlegte E-Mail';
      alert(`Test-E-Mail erfolgreich versendet an ${target}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Test email failed');
    } finally {
      setSendingTestEmail(false);
    }
  };

  const formatEta = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('de-DE', {
      timeZone: 'Europe/Berlin',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
    });

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Vessel Watchlist</h1>
      <p style={styles.subtitle}>
        Vessels beobachten und bei ETA-Aenderungen benachrichtigt werden.
      </p>

      <div style={{ marginBottom: '14px' }}>
        <button
          onClick={handleSendTestEmail}
          disabled={sendingTestEmail}
          style={styles.btnTestEmail}
        >
          {sendingTestEmail ? 'Sende Test-E-Mail...' : 'Test-E-Mail senden'}
        </button>
      </div>

      <form onSubmit={handleAdd} style={styles.form}>
        <div style={styles.formRow}>
          <div style={styles.autocompleteWrap}>
            <input
              type="text"
              placeholder="Vessel Name (z.B. EVER GIVEN)"
              value={vesselName}
              onChange={(e) => setVesselName(e.target.value)}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              onBlur={() => {
                blurTimeout.current = setTimeout(() => setShowSuggestions(false), 150);
              }}
              style={styles.input}
              autoComplete="off"
              required
            />
            {showSuggestions && suggestions.length > 0 && (
              <div style={styles.dropdown}>
                {suggestions.map((v) => (
                  <div
                    key={v.name_normalized}
                    style={styles.dropdownItem}
                    onMouseDown={() => {
                      if (blurTimeout.current) clearTimeout(blurTimeout.current);
                      setVesselName(v.name);
                      setSuggestions([]);
                      setShowSuggestions(false);
                    }}
                  >
                    {v.name}
                  </div>
                ))}
              </div>
            )}
          </div>
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

      {error && (
        <div style={styles.error}>
          {error}
          <button onClick={() => setError('')} style={styles.errorClose}>
            x
          </button>
        </div>
      )}

      <div style={styles.searchRow}>
        <input
          type="text"
          value={watchSearch}
          onChange={(e) => setWatchSearch(e.target.value)}
          placeholder="Watchlist durchsuchen (Vessel oder S-Nr.)"
          style={styles.input}
        />
      </div>

      {loading && <p style={styles.loadingText}>Watchlist wird geladen...</p>}

      {!loading && filteredWatches.length === 0 && (
        <div style={styles.empty}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Noch keine Vessels auf der Watchlist
          </p>
          <p style={{ margin: '8px 0 0', color: '#666' }}>
            Füge oben ein Vessel hinzu, um bei ETA-Änderungen benachrichtigt zu werden.
          </p>
        </div>
      )}

      {filteredWatches.length > 0 && (
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
              {filteredWatches.map((watch) => (
                <tr key={watch.id}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{watch.vessel_name}</td>
                  <td style={styles.td}>{watch.shipment_reference || '-'}</td>
                  <td style={styles.td}>{formatEta(watch.last_known_eta)}</td>
                  <td style={styles.td}>
                    <button
                      onClick={() => handleToggleNotification(watch)}
                      style={{
                        ...styles.btnToggle,
                        backgroundColor: watch.notification_enabled ? '#dcfce7' : '#f3f4f6',
                        color: watch.notification_enabled ? '#15803d' : '#888',
                      }}
                    >
                      {watch.notification_enabled ? 'Aktiv' : 'Aus'}
                    </button>
                  </td>
                  <td style={{ ...styles.td, color: '#666', fontSize: '13px' }}>
                    {formatDate(watch.created_at)}
                  </td>
                  <td style={styles.td}>
                    <button onClick={() => handleDelete(watch.id)} style={styles.btnDelete}>
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
  searchRow: {
    marginBottom: '12px',
  },
  formRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  autocompleteWrap: {
    position: 'relative',
    flex: 1,
    minWidth: '200px',
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
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    marginTop: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    zIndex: 10,
    maxHeight: '240px',
    overflowY: 'auto',
  },
  dropdownItem: {
    padding: '10px 14px',
    fontSize: '14px',
    cursor: 'pointer',
    borderBottom: '1px solid #f3f4f6',
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
    whiteSpace: 'nowrap',
  },
  btnTestEmail: {
    padding: '10px 14px',
    backgroundColor: '#0ea5e9',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
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
    fontSize: '16px',
    cursor: 'pointer',
    padding: '0 4px',
  },
  loadingText: {
    textAlign: 'center',
    color: '#666',
    padding: '32px',
  },
  empty: {
    textAlign: 'center',
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
    borderCollapse: 'collapse',
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: '13px',
    color: '#666',
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
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
