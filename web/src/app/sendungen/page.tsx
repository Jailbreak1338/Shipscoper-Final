'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  AlertCircle,
  Loader2,
  TrendingUp,
  TrendingDown,
  Boxes,
  PackageOpen,
  Search,
  CalendarDays,
  Bell,
  BellOff,
  Truck,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';

interface ContainerRow {
  watch_id: string;
  vessel_name: string;
  shipment_reference: string | null;
  container_source: string | null;
  has_container: boolean;
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
  delivery_date: string | null;
  notification_enabled: boolean;
}

type Tab = 'container' | 'stueckgut' | 'ohneeta';

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PREANNOUNCED:  { label: 'Avisiert',      className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  DISCHARGED:    { label: 'Entladen',      className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  READY:         { label: 'Abnahmebereit', className: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  DELIVERED_OUT: { label: 'Ausgeliefert',  className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};

const SELECT_CLS =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-w-0';

function isWithin7Days(iso: string | null): boolean {
  if (!iso) return false;
  const d = Date.parse(iso);
  if (isNaN(d)) return false;
  const now = Date.now();
  return d >= now && d <= now + 7 * 86_400_000;
}

/** True when Anliefertermin is before the ship's ETD — delivery impossible before departure */
function isDeliveryBeforeEtd(deliveryDate: string | null, etd: string | null): boolean {
  if (!deliveryDate || !etd) return false;
  const d = Date.parse(deliveryDate);
  const e = Date.parse(etd);
  if (isNaN(d) || isNaN(e)) return false;
  return d < e;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function fmtTs(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function DayDeltaBadge({ days }: { days: number | null }) {
  if (days == null || days === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const pos = days > 0;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', pos ? 'text-red-400' : 'text-emerald-400')}>
      {pos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pos ? '+' : ''}{days}d
    </span>
  );
}

function StatusBadge({ status, raw }: { status: string | null; raw: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">Ausstehend</span>;
  const cfg = STATUS_CONFIG[status];
  return (
    <div>
      <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold', cfg?.className ?? 'bg-muted text-muted-foreground')}>
        {cfg?.label ?? status}
      </span>
      {raw && raw !== status && (
        <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{raw}</div>
      )}
    </div>
  );
}

function normalizeTerminalName(t: string | null): string | null {
  if (!t) return null;
  if (t.toLowerCase() === 'eurogate') return 'Eurogate';
  return t;
}

function sortByEta<T extends { eta: string | null }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    if (!a.eta && !b.eta) return 0;
    if (!a.eta) return 1;
    if (!b.eta) return -1;
    return Date.parse(a.eta) - Date.parse(b.eta);
  });
}

function TerminalCell({ terminal, vesselTerminal }: { terminal: string | null; vesselTerminal: string | null }) {
  const t = normalizeTerminalName(terminal ?? vesselTerminal ?? null);
  return t
    ? <Badge variant="outline" className="text-xs font-normal">{t}</Badge>
    : <span className="text-muted-foreground text-xs">—</span>;
}

export default function SendungenPage() {
  const [rows, setRows] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('container');
  const [togglingNotif, setTogglingNotif] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [dispoing, setDispoing] = useState(false);
  const [dispoMsg, setDispoMsg] = useState('');

  // Filters — separate state per tab
  const [cSnr,      setCSnr]      = useState('');
  const [cContainer, setCContainer] = useState('');
  const [cVessel,   setCVessel]   = useState('');
  const [cTerminal, setCTerminal] = useState('');
  const [cStatus,   setCStatus]   = useState('');

  const [sSnr,      setSSnr]      = useState('');
  const [sVessel,   setSVessel]   = useState('');
  const [sTerminal, setSTerminal] = useState('');

  const [cNext7, setCNext7] = useState(false);
  const [sNext7, setSNext7] = useState(false);

  const [oSnr,    setOSnr]    = useState('');
  const [oVessel, setOVessel] = useState('');

  const loadData = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    fetch('/api/sendungen')
      .then((r) => r.json())
      .then((json) => {
        if (!json.sendungen) throw new Error(json.error || 'Fehler beim Laden');
        setRows(json.sendungen as ContainerRow[]);
        setLastUpdated(new Date());
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Fehler'))
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  useEffect(() => {
    loadData();
    // Auto-refresh every 3 minutes (silent — no loading spinner)
    autoRefreshRef.current = setInterval(() => loadData(true), 3 * 60 * 1000);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [loadData]);

  const containerRows = useMemo(() => rows.filter((r) => r.has_container), [rows]);
  const stueckgutRows = useMemo(() => rows.filter((r) => !r.has_container), [rows]);

  // Dynamic dropdown options
  const containerVessels  = useMemo(() => [...new Set(containerRows.map((r) => r.vessel_name))].sort(), [containerRows]);
  const containerTerminals = useMemo(() => [...new Set(containerRows.map((r) => r.terminal ?? r.vessel_terminal ?? '').filter(Boolean))].sort(), [containerRows]);
  const stueckgutVessels  = useMemo(() => [...new Set(stueckgutRows.map((r) => r.vessel_name))].sort(), [stueckgutRows]);
  const stueckgutTerminals = useMemo(() => [...new Set(stueckgutRows.map((r) => r.vessel_terminal ?? '').filter(Boolean))].sort(), [stueckgutRows]);

  const filteredContainer = useMemo(() => {
    const snr = cSnr.trim().toLowerCase();
    const cnt = cContainer.trim().toLowerCase();
    const result = containerRows.filter((r) => {
      if (snr && !(r.shipment_reference ?? '').toLowerCase().includes(snr)) return false;
      if (cnt && !r.container_no.toLowerCase().includes(cnt)) return false;
      if (cVessel   && r.vessel_name !== cVessel) return false;
      if (cTerminal && (r.terminal ?? r.vessel_terminal) !== cTerminal) return false;
      if (cStatus   && r.normalized_status !== cStatus) return false;
      if (cNext7    && !isWithin7Days(r.eta)) return false;
      return true;
    });
    return sortByEta(result);
  }, [containerRows, cSnr, cContainer, cVessel, cTerminal, cStatus, cNext7]);

  const filteredStueckgut = useMemo(() => {
    const snr = sSnr.trim().toLowerCase();
    const result = stueckgutRows.filter((r) => {
      if (snr     && !(r.shipment_reference ?? '').toLowerCase().includes(snr)) return false;
      if (sVessel   && r.vessel_name !== sVessel) return false;
      if (sTerminal && (r.vessel_terminal ?? '') !== sTerminal) return false;
      if (sNext7    && !isWithin7Days(r.eta)) return false;
      return true;
    });
    return sortByEta(result);
  }, [stueckgutRows, sSnr, sVessel, sTerminal, sNext7]);

  const ohneEtaRows = useMemo(() => rows.filter((r) => !r.eta), [rows]);
  const ohneEtaVessels = useMemo(() => [...new Set(ohneEtaRows.map((r) => r.vessel_name))].sort(), [ohneEtaRows]);

  const filteredOhneEta = useMemo(() => {
    const snr = oSnr.trim().toLowerCase();
    return ohneEtaRows.filter((r) => {
      if (snr && !(r.shipment_reference ?? '').toLowerCase().includes(snr)) return false;
      if (oVessel && r.vessel_name !== oVessel) return false;
      return true;
    });
  }, [ohneEtaRows, oSnr, oVessel]);

  const activeRows =
    activeTab === 'container' ? containerRows :
    activeTab === 'stueckgut' ? stueckgutRows : ohneEtaRows;
  const filtered =
    activeTab === 'container' ? filteredContainer :
    activeTab === 'stueckgut' ? filteredStueckgut : filteredOhneEta;

  const cActiveFilters = [cSnr, cContainer, cVessel, cTerminal, cStatus].some(Boolean) || cNext7;
  const sActiveFilters = [sSnr, sVessel, sTerminal].some(Boolean) || sNext7;
  const oActiveFilters = [oSnr, oVessel].some(Boolean);
  const anyFilter =
    activeTab === 'container' ? cActiveFilters :
    activeTab === 'stueckgut' ? sActiveFilters : oActiveFilters;

  const clearC = () => { setCSnr(''); setCContainer(''); setCVessel(''); setCTerminal(''); setCStatus(''); setCNext7(false); };
  const clearS = () => { setSSnr(''); setSVessel(''); setSTerminal(''); setSNext7(false); };
  const clearO = () => { setOSnr(''); setOVessel(''); };

  const stats = useMemo(() => ({
    total:       filtered.length,
    withStatus:  containerRows.filter((r) => r.normalized_status).length,
    ready:       containerRows.filter((r) => r.normalized_status === 'READY').length,
    discharged:  containerRows.filter((r) => r.normalized_status === 'DISCHARGED').length,
    delivered:   containerRows.filter((r) => r.normalized_status === 'DELIVERED_OUT').length,
  }), [filtered, containerRows]);

  const handleToggleNotif = async (watchId: string, current: boolean) => {
    setTogglingNotif(watchId);
    try {
      await fetch(`/api/watchlist/${watchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_enabled: !current }),
      });
      loadData(true);
    } finally {
      setTogglingNotif(null);
    }
  };

  const handleAutoDispo = async () => {
    const flagged = containerRows.filter((r) => isDeliveryBeforeEtd(r.delivery_date, r.etd));
    if (flagged.length === 0) {
      setDispoMsg('Keine rot markierten Anliefertermine gefunden.');
      return;
    }
    setDispoing(true);
    setDispoMsg('');
    try {
      const res = await fetch('/api/sendungen/auto-dispo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: flagged.map((r) => ({
            container_no:       r.container_no,
            shipment_reference: r.shipment_reference,
            delivery_date:      r.delivery_date,
            etd:                r.etd,
            vessel_name:        r.vessel_name,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Fehler');
      setDispoMsg(`E-Mail gesendet: ${json.count} Container gemeldet.`);
    } catch (e: unknown) {
      setDispoMsg(e instanceof Error ? e.message : 'Fehler beim Senden');
    } finally {
      setDispoing(false);
    }
  };

  const EmptyIcon = activeTab === 'container' ? Boxes : activeTab === 'stueckgut' ? PackageOpen : HelpCircle;

  return (
    <div className="max-w-[1400px] mx-auto p-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sendungen</h1>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Live · {rows.length} Einträge
              {lastUpdated && (
                <span className="text-muted-foreground/60">
                  · aktualisiert {lastUpdated.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </span>
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleAutoDispo}
          disabled={dispoing}
          className="shrink-0 gap-2"
          title="Sendet E-Mail für alle rot markierten Anliefertermine"
        >
          {dispoing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
          Auto Dispo
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted/50 rounded-lg w-fit border border-border">
        {([
          { key: 'container' as Tab, label: 'Container',  icon: Boxes,       count: containerRows.length },
          { key: 'stueckgut' as Tab, label: 'Stückgut',   icon: PackageOpen, count: stueckgutRows.length },
          { key: 'ohneeta'   as Tab, label: 'Ohne ETA',   icon: HelpCircle,  count: ohneEtaRows.length },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
              activeTab === tab.key
                ? 'bg-background text-foreground shadow-sm border border-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            <span className={cn(
              'ml-0.5 text-xs rounded-full px-1.5 py-0.5 font-semibold',
              activeTab === tab.key ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Stats (Container tab only) */}
      {activeTab === 'container' && !loading && containerRows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: 'Gefiltert',    value: stats.total,      className: '' },
            { label: 'Mit Status',   value: stats.withStatus, className: '' },
            { label: 'Bereit',       value: stats.ready,      className: 'text-sky-400' },
            { label: 'Entladen',     value: stats.discharged, className: 'text-amber-400' },
            { label: 'Ausgeliefert', value: stats.delivered,  className: 'text-emerald-400' },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <div className={cn('text-2xl font-bold', s.className || 'text-foreground')}>{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wide">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Feedback */}
      {dispoMsg && (
        <Alert variant={dispoMsg.startsWith('Fehler') ? 'destructive' : 'default'}>
          <Truck className="h-4 w-4" />
          <AlertDescription>{dispoMsg}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Filters ──────────────────────────────────────────────────── */}
      {activeTab === 'container' ? (
        <div className="flex flex-wrap items-center gap-2">

          {/* S-Nr */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search" placeholder="S-Nr." value={cSnr}
              onChange={(e) => setCSnr(e.target.value)}
              className="pl-8 w-36 h-10"
            />
          </div>
          {/* Container */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search" placeholder="Container-Nr." value={cContainer}
              onChange={(e) => setCContainer(e.target.value)}
              className="pl-8 w-44 h-10"
            />
          </div>
          {/* Vessel */}
          <select title="Schiff filtern" value={cVessel} onChange={(e) => setCVessel(e.target.value)} className={cn(SELECT_CLS, 'w-48')}>
            <option value="">Alle Schiffe</option>
            {containerVessels.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          {/* Terminal */}
          <select title="Terminal filtern" value={cTerminal} onChange={(e) => setCTerminal(e.target.value)} className={cn(SELECT_CLS, 'w-44')}>
            <option value="">Alle Terminals</option>
            {containerTerminals.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {/* Status */}
          <select title="Status filtern" value={cStatus} onChange={(e) => setCStatus(e.target.value)} className={cn(SELECT_CLS, 'w-40')}>
            <option value="">Alle Status</option>
            <option value="PREANNOUNCED">Avisiert</option>
            <option value="DISCHARGED">Entladen</option>
            <option value="READY">Abnahmebereit</option>
            <option value="DELIVERED_OUT">Ausgeliefert</option>
          </select>
          {/* Next 7 days */}
          <Button
            variant={cNext7 ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setCNext7((v) => !v)}
            className="gap-1.5 h-10"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Nächste 7 Tage
          </Button>
          {cActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearC} className="gap-1.5 h-10">
              <X className="h-3.5 w-3.5" />Filter zurücksetzen
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredContainer.length} / {containerRows.length} Einträge
          </span>
        </div>
      ) : activeTab === 'stueckgut' ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* S-Nr */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search" placeholder="S-Nr." value={sSnr}
              onChange={(e) => setSSnr(e.target.value)}
              className="pl-8 w-36 h-10"
            />
          </div>
          {/* Vessel */}
          <select title="Schiff filtern" value={sVessel} onChange={(e) => setSVessel(e.target.value)} className={cn(SELECT_CLS, 'w-48')}>
            <option value="">Alle Schiffe</option>
            {stueckgutVessels.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          {/* Terminal */}
          <select title="Terminal filtern" value={sTerminal} onChange={(e) => setSTerminal(e.target.value)} className={cn(SELECT_CLS, 'w-44')}>
            <option value="">Alle Terminals</option>
            {stueckgutTerminals.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {/* Next 7 days */}
          <Button
            variant={sNext7 ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setSNext7((v) => !v)}
            className="gap-1.5 h-10"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Nächste 7 Tage
          </Button>
          {sActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearS} className="gap-1.5 h-10">
              <X className="h-3.5 w-3.5" />Filter zurücksetzen
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredStueckgut.length} / {stueckgutRows.length} Einträge
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search" placeholder="S-Nr." value={oSnr}
              onChange={(e) => setOSnr(e.target.value)}
              className="pl-8 w-36 h-10"
            />
          </div>
          <select title="Schiff filtern" value={oVessel} onChange={(e) => setOVessel(e.target.value)} className={cn(SELECT_CLS, 'w-48')}>
            <option value="">Alle Schiffe</option>
            {ohneEtaVessels.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          {oActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearO} className="gap-1.5 h-10">
              <X className="h-3.5 w-3.5" />Filter zurücksetzen
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredOhneEta.length} / {ohneEtaRows.length} Einträge
          </span>
        </div>
      )}

      {/* ── Tables ───────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Sendungen werden geladen…
        </div>
      ) : activeRows.length === 0 && !error ? (
        <Card>
          <CardContent className="text-center py-16">
            <EmptyIcon className="h-10 w-10 text-muted-foreground mx-auto mb-4 opacity-40" />
            <p className="font-medium text-foreground">
              {activeTab === 'container' ? 'Keine Container-Sendungen' : activeTab === 'stueckgut' ? 'Keine Stückgut-Sendungen' : 'Alle Sendungen haben ETA'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {activeTab === 'container'
                ? 'Lade eine Excel-Datei mit Container-Spalte (ISO-6346) hoch.'
                : activeTab === 'stueckgut'
                ? 'Sendungen ohne ISO-Container-Nummer erscheinen hier.'
                : 'Sobald Sendungen ohne ETA vorliegen, erscheinen sie hier.'}
            </p>
          </CardContent>
        </Card>
      ) : activeTab === 'container' ? (

        /* ── Container Table ──────────────────────────────────────── */
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase tracking-wide">S-Nr.</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Container</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Schiff</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">ETA</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Δ ETA</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">ETD</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Δ ETD</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Anliefertermin</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Terminal</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Status</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Abgerufen</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-10 text-muted-foreground">
                    {anyFilter ? 'Keine Treffer für die aktiven Filter.' : 'Keine Container-Sendungen vorhanden.'}
                  </TableCell>
                </TableRow>
              ) : filtered.map((row, i) => (
                <TableRow key={`${row.watch_id}::${row.container_no}::${row.shipment_reference ?? i}`}>
                  <TableCell>
                    {row.shipment_reference
                      ? <Badge variant="secondary" className="font-mono text-xs">{row.shipment_reference}</Badge>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs font-mono font-semibold text-foreground">{row.container_no}</code>
                  </TableCell>
                  <TableCell className="text-sm max-w-36 truncate">{row.vessel_name}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.eta)}</TableCell>
                  <TableCell><DayDeltaBadge days={row.eta_change_days} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtDate(row.etd)}</TableCell>
                  <TableCell><DayDeltaBadge days={row.etd_change_days} /></TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {row.delivery_date ? (
                      <span className={cn(
                        isDeliveryBeforeEtd(row.delivery_date, row.etd) && 'text-red-400 font-semibold'
                      )}>
                        {fmtDate(row.delivery_date)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell><TerminalCell terminal={row.terminal} vesselTerminal={row.vessel_terminal} /></TableCell>
                  <TableCell><StatusBadge status={row.normalized_status} raw={row.status_raw} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtTs(row.scraped_at)}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      title={row.notification_enabled ? 'Benachrichtigungen deaktivieren' : 'Benachrichtigungen aktivieren'}
                      disabled={togglingNotif === row.watch_id}
                      onClick={() => handleToggleNotif(row.watch_id, row.notification_enabled)}
                      className={cn(
                        'p-1.5 rounded-md transition-colors',
                        row.notification_enabled
                          ? 'text-emerald-400 hover:bg-emerald-500/15'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        togglingNotif === row.watch_id && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      {togglingNotif === row.watch_id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : row.notification_enabled
                          ? <Bell className="h-4 w-4" />
                          : <BellOff className="h-4 w-4" />}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

      ) : activeTab === 'stueckgut' ? (

        /* ── Stückgut Table ───────────────────────────────────────── */
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase tracking-wide">Schiff</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">S-Nr.</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">ETA</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Δ ETA</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">ETD</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Δ ETD</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Terminal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    {anyFilter ? 'Keine Treffer für die aktiven Filter.' : 'Keine Stückgut-Sendungen vorhanden.'}
                  </TableCell>
                </TableRow>
              ) : filtered.map((row, i) => (
                <TableRow key={`${row.watch_id}::${row.shipment_reference ?? i}`}>
                  <TableCell className="text-sm max-w-48 truncate font-medium">{row.vessel_name}</TableCell>
                  <TableCell>
                    {row.shipment_reference
                      ? <Badge variant="secondary" className="font-mono text-xs">{row.shipment_reference}</Badge>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.eta)}</TableCell>
                  <TableCell><DayDeltaBadge days={row.eta_change_days} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtDate(row.etd)}</TableCell>
                  <TableCell><DayDeltaBadge days={row.etd_change_days} /></TableCell>
                  <TableCell><TerminalCell terminal={row.terminal} vesselTerminal={row.vessel_terminal} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

      ) : (

        /* ── Ohne ETA Table ───────────────────────────────────────── */
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase tracking-wide">Typ</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">S-Nr.</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Container</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Schiff</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Anliefertermin</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    {anyFilter ? 'Keine Treffer für die aktiven Filter.' : 'Keine Sendungen ohne ETA vorhanden.'}
                  </TableCell>
                </TableRow>
              ) : filtered.map((row, i) => (
                <TableRow key={`ohneeta::${row.watch_id}::${row.container_no}::${row.shipment_reference ?? i}`}>
                  <TableCell>
                    <Badge variant="outline" className="text-xs font-normal whitespace-nowrap">
                      {row.has_container ? 'Container' : 'Stückgut'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {row.shipment_reference
                      ? <Badge variant="secondary" className="font-mono text-xs">{row.shipment_reference}</Badge>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell>
                    {row.has_container
                      ? <code className="text-xs font-mono font-semibold text-foreground">{row.container_no}</code>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-sm max-w-48 truncate">{row.vessel_name}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {row.delivery_date ? (
                      <span className={cn(isDeliveryBeforeEtd(row.delivery_date, row.etd) && 'text-red-400 font-semibold')}>
                        {fmtDate(row.delivery_date)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      title={row.notification_enabled ? 'Benachrichtigungen deaktivieren' : 'Benachrichtigungen aktivieren'}
                      disabled={togglingNotif === row.watch_id}
                      onClick={() => handleToggleNotif(row.watch_id, row.notification_enabled)}
                      className={cn(
                        'p-1.5 rounded-md transition-colors',
                        row.notification_enabled
                          ? 'text-emerald-400 hover:bg-emerald-500/15'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        togglingNotif === row.watch_id && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      {togglingNotif === row.watch_id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : row.notification_enabled
                          ? <Bell className="h-4 w-4" />
                          : <BellOff className="h-4 w-4" />}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
