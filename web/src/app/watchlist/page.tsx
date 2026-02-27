'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Eye,
  Plus,
  Trash2,
  Bell,
  BellOff,
  Search,
  Loader2,
  AlertCircle,
  Ship,
  X,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface ContainerStatus {
  container_no: string;
  normalized_status: 'PREANNOUNCED' | 'DISCHARGED' | 'READY' | 'DELIVERED_OUT';
  status_raw: string | null;
  terminal: string | null;
  updated_at: string;
  ready_for_loading: boolean | null;
  discharge_order_status: string | null;
}

interface Watch {
  id: string;
  vessel_name: string;
  vessel_name_normalized: string;
  shipment_reference: string | null;
  container_source: 'HHLA' | 'EUROGATE' | 'AUTO' | null;
  shipper_source: string | null;
  shipment_mode: 'LCL' | 'FCL' | null;
  container_reference: string | null;
  last_known_eta: string | null;
  notification_enabled: boolean;
  created_at: string;
  last_notified_at: string | null;
  container_statuses?: ContainerStatus[];
}

function StatusBadge({ status }: { status: ContainerStatus['normalized_status'] | 'UNKNOWN' }) {
  const map: Record<string, { label: string; className: string }> = {
    PREANNOUNCED:  { label: 'Avisiert',       className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
    DISCHARGED:    { label: 'Entladen',       className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
    READY:         { label: 'Abnahmebereit',  className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    DELIVERED_OUT: { label: 'Ausgeliefert',   className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    UNKNOWN:       { label: 'Nicht avisiert', className: 'bg-muted/50 text-muted-foreground border-border' },
  };
  const { label, className } = map[status] ?? map.UNKNOWN;
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
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
  const [shipmentReference, setShipmentReference] = useState('');
  const [shipperSource, setShipperSource] = useState('');
  const [shipmentMode, setShipmentMode] = useState<'LCL' | 'FCL'>('LCL');
  const [containerRefInput, setContainerRefInput] = useState('');
  const [containerSource, setContainerSource] = useState<'HHLA' | 'EUROGATE' | 'AUTO'>('AUTO');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');
  const [watchSearch, setWatchSearch] = useState('');
  const [suggestions, setSuggestions] = useState<VesselSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchWatches = async () => {
    try {
      const res = await fetch('/api/watchlist');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load watchlist');
      const nextWatches = (json.watches ?? []) as Watch[];
      setWatches(nextWatches);
      setSelectedIds((prev) => prev.filter((id) => nextWatches.some((w) => w.id === id)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load watchlist');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWatches();
    autoRefreshRef.current = setInterval(fetchWatches, 3 * 60 * 1000);
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (vesselName.trim().length < 2) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/vessels/search?q=${encodeURIComponent(vesselName.trim())}`);
        const json = await res.json();
        if (res.ok) {
          const vessels: VesselSuggestion[] = json.vessels ?? [];
          setSuggestions(vessels);
          setShowSuggestions(vessels.length > 0);
        }
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [vesselName]);

  const filteredWatches = watches
    .filter((watch) => {
      const q = watchSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        watch.vessel_name.toLowerCase().includes(q) ||
        (watch.shipment_reference || '').toLowerCase().includes(q) ||
        (watch.container_reference || '').toLowerCase().includes(q) ||
        (watch.shipper_source || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (!a.last_known_eta && !b.last_known_eta) return 0;
      if (!a.last_known_eta) return 1;
      if (!b.last_known_eta) return -1;
      return Date.parse(a.last_known_eta) - Date.parse(b.last_known_eta);
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
          shipmentReference: shipmentReference.trim(),
          shipperSource: shipperSource.trim(),
          shipmentMode,
          containerReference: shipmentMode === 'FCL' ? containerRefInput.trim() : '',
          containerSource,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to add vessel');
      setWatches((prev) => {
        const idx = prev.findIndex((w) => w.id === json.watch.id);
        if (idx >= 0) { const copy = [...prev]; copy[idx] = json.watch; return copy; }
        return [json.watch, ...prev];
      });
      setVesselName('');
      setShipmentReference('');
      setShipperSource('');
      setShipmentMode('LCL');
      setContainerRefInput('');
      setContainerSource('AUTO');
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
        body: JSON.stringify({ notification_enabled: !watch.notification_enabled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update');
      setWatches((prev) => prev.map((w) => (w.id === watch.id ? json.watch : w)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Vessel von der Watchlist entfernen?')) return;
    try {
      const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      if (!res.ok) { const json = await res.json(); throw new Error(json.error || 'Failed to delete'); }
      setWatches((prev) => prev.filter((w) => w.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };


  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = filteredWatches.map((w) => w.id);
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) => {
      if (allSelected) return prev.filter((id) => !filteredIds.includes(id));
      return [...new Set([...prev, ...filteredIds])];
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`${selectedIds.length} Einträge von der Watchlist entfernen?`)) return;
    try {
      const res = await fetch('/api/watchlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Bulk delete fehlgeschlagen');
      setWatches((prev) => prev.filter((w) => !selectedIds.includes(w.id)));
      setSelectedIds([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bulk delete fehlgeschlagen');
    }
  };

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    setRefreshMessage('');
    setError('');
    try {
      const res = await fetch('/api/container-refresh', { method: 'POST' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Fehler beim Starten des Checks');
      }
      setRefreshMessage('Status-Check gestartet — Ergebnisse in ~60 Sek…');
      setTimeout(async () => {
        await fetchWatches();
        setRefreshMessage('');
        setRefreshing(false);
      }, 65000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Refresh fehlgeschlagen');
      setRefreshing(false);
    }
  };

  const formatEta = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vessel Watchlist</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vessels beobachten · S-Nr. werden automatisch über Excel-Uploads zugeordnet
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshStatus}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Status abrufen
          </Button>
        </div>
      </div>

      {refreshMessage && (
        <Alert>
          <RefreshCw className="h-4 w-4 animate-spin" />
          <AlertDescription>{refreshMessage}</AlertDescription>
        </Alert>
      )}


      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            {error}
            <button type="button" aria-label="Fehler schließen" onClick={() => setError('')} className="ml-2 hover:opacity-70">
              <X className="h-3.5 w-3.5" />
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Add Vessel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Vessel hinzufügen</CardTitle>
          <CardDescription>Name eingeben — Autocomplete aus Datenbank</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd}>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Vessel Name (z.B. EVER GIVEN)"
                  value={vesselName}
                  onChange={(e) => setVesselName(e.target.value)}
                  onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                  onBlur={() => { blurTimeout.current = setTimeout(() => setShowSuggestions(false), 150); }}
                  className="pl-9"
                  autoComplete="off"
                  required
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
                    {suggestions.map((v) => (
                      <div
                        key={v.name_normalized}
                        className="flex items-center gap-2 px-3 py-2.5 text-sm cursor-pointer hover:bg-accent transition-colors"
                        onMouseDown={() => {
                          if (blurTimeout.current) clearTimeout(blurTimeout.current);
                          setVesselName(v.name);
                          setSuggestions([]);
                          setShowSuggestions(false);
                        }}
                      >
                        <Ship className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {v.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Input
                type="text"
                placeholder="S-Nr. (Pflicht)"
                value={shipmentReference}
                onChange={(e) => setShipmentReference(e.target.value)}
                className="w-48"
                required
              />
              <Input
                type="text"
                placeholder="Source / Shipper (z.B. Ziehl-Abegg)"
                value={shipperSource}
                onChange={(e) => setShipperSource(e.target.value)}
                className="w-56"
              />
              <select
                title="Mode"
                value={shipmentMode}
                onChange={(e) => setShipmentMode(e.target.value as 'LCL' | 'FCL')}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="LCL">LCL (Stückgut)</option>
                <option value="FCL">FCL (Container)</option>
              </select>
              {shipmentMode === 'FCL' && (
                <Input
                  type="text"
                  placeholder="Container (optional/manuell)"
                  value={containerRefInput}
                  onChange={(e) => setContainerRefInput(e.target.value)}
                  className="w-48"
                />
              )}
              <select
                title="Source"
                value={containerSource}
                onChange={(e) => setContainerSource(e.target.value as 'HHLA' | 'EUROGATE' | 'AUTO')}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="AUTO">Auto</option>
                <option value="HHLA">HHLA</option>
                <option value="EUROGATE">Eurogate</option>
              </select>
              <Button type="submit" disabled={adding || !vesselName.trim() || !shipmentReference.trim()}>
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Hinzufügen
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Watchlist Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Meine Watchlist</CardTitle>
              <CardDescription>{watches.length} Vessels beobachtet</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={selectedIds.length === 0}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Bulk löschen ({selectedIds.length})
              </Button>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="text"
                value={watchSearch}
                onChange={(e) => setWatchSearch(e.target.value)}
                placeholder="Suchen…"
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Watchlist wird geladen…
            </div>
          ) : filteredWatches.length === 0 ? (
            <div className="text-center py-12">
              <Eye className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="font-medium text-foreground">Noch keine Vessels</p>
              <p className="text-sm text-muted-foreground mt-1">
                {watchSearch ? 'Keine Treffer für diese Suche.' : 'Füge oben ein Vessel hinzu.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={filteredWatches.length > 0 && filteredWatches.every((w) => selectedIds.includes(w.id))}
                      onChange={toggleSelectAllFiltered}
                    />
                  </TableHead>
                  <TableHead>Vessel</TableHead>
                  <TableHead>Sendung</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Letzte ETA</TableHead>
                  <TableHead>Benachrichtigung</TableHead>
                  <TableHead>Hinzugefügt</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredWatches.map((watch) => (
                  <TableRow key={watch.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(watch.id)}
                        onChange={() => toggleSelected(watch.id)}
                      />
                    </TableCell>
                    <TableCell className="font-semibold">{watch.vessel_name}</TableCell>
                    <TableCell>
                      {watch.shipment_reference ? (
                        <Badge variant="secondary" className="font-mono text-xs">
                          {watch.shipment_reference}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {watch.container_reference ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {watch.container_reference.split(',').length > 1
                            ? `${watch.container_reference.split(',')[0].trim()} +${watch.container_reference.split(',').length - 1}`
                            : watch.container_reference}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{watch.shipper_source ?? watch.container_source ?? '—'}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{watch.shipment_mode ?? (watch.container_reference ? 'FCL' : 'LCL')}</Badge>
                    </TableCell>
                    <TableCell>
                      {watch.container_reference ? (
                        <div className="flex flex-wrap gap-1">
                          {(watch.container_statuses ?? []).length > 0 ? (
                            (watch.container_statuses ?? []).map((cs) => (
                              <div key={cs.container_no} className="flex flex-col gap-0.5">
                                <StatusBadge status={cs.normalized_status} />
                                <span className="font-mono text-[10px] text-muted-foreground">{cs.container_no}</span>
                              </div>
                            ))
                          ) : (
                            <StatusBadge status="UNKNOWN" />
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{formatEta(watch.last_known_eta)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={watch.notification_enabled}
                          onCheckedChange={() => handleToggleNotification(watch)}
                        />
                        <span className={cn('text-xs font-medium', watch.notification_enabled ? 'text-emerald-400' : 'text-muted-foreground')}>
                          {watch.notification_enabled ? 'Aktiv' : 'Aus'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(watch.created_at)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(watch.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
