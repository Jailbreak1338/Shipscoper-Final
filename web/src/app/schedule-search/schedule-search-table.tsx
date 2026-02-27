'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, TrendingUp, TrendingDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

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
  if (!value) return '—';
  return new Date(value).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
}

export default function ScheduleSearchTable({
  rows,
  initialShipmentByVessel,
  initialContainerByVessel,
  initialSnrFilter,
  initialListSourceByVessel,
}: {
  rows: SearchRow[];
  initialShipmentByVessel: ShipmentMap;
  initialContainerByVessel: ShipmentMap;
  initialListSourceByVessel: Record<string, string>;
  initialSnrFilter?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [shipmentByVessel] = useState<ShipmentMap>(initialShipmentByVessel);
  const [containerByVessel] = useState<ShipmentMap>(initialContainerByVessel);
  const [snrFilter, setSnrFilter] = useState(initialSnrFilter ?? '');
  const [listSourceByVessel] = useState<Record<string, string>>(initialListSourceByVessel);
  const [listSourceFilter, setListSourceFilter] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [onlyWithSnr, setOnlyWithSnr] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSnrChange = (value: string) => {
    setSnrFilter(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set('snr', value.trim());
      } else {
        params.delete('snr');
      }
      params.delete('page'); // reset to page 1
      router.push(`/schedule-search?${params.toString()}`);
    }, 400);
  };

  const uniqueVesselsOnPage = useMemo(
    () => new Set(rows.map((r) => r.vessel_name_normalized)).size,
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = snrFilter.trim().toLowerCase();
    return rows.filter((row) => {
      const vesselShipments = shipmentByVessel[row.vessel_name_normalized] ?? [];
      if (onlyUnassigned && vesselShipments.length > 0) return false;
      if (onlyWithSnr && vesselShipments.length === 0) return false;
      const listSource = listSourceByVessel[row.vessel_name_normalized] ?? 'UNSET';
      if (listSourceFilter && listSource !== listSourceFilter) return false;
      if (!q) return true;
      return vesselShipments.some((snr) => snr.toLowerCase().includes(q));
    });
  }, [rows, shipmentByVessel, snrFilter, onlyUnassigned, onlyWithSnr, listSourceByVessel, listSourceFilter]);

  const listSourceOptions = useMemo(() => [
    ...new Set(Object.values(listSourceByVessel).map((v) => v || 'UNSET').concat('UNSET')),
  ].sort(), [listSourceByVessel]);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {filteredRows.length} Zeilen · {uniqueVesselsOnPage} Schiffe
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              value={snrFilter}
              onChange={(e) => handleSnrChange(e.target.value)}
              placeholder="S-Nr. filtern…"
              className="pl-8 h-8 text-sm w-44"
            />
          </div>
          <select
            aria-label="Listen-Source"
            value={listSourceFilter}
            onChange={(e) => setListSourceFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">Alle Listen-Sources</option>
            {listSourceOptions.map((src) => <option key={src} value={src}>{src === 'UNSET' ? '—' : src}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyUnassigned}
              onChange={(e) => { setOnlyUnassigned(e.target.checked); if (e.target.checked) setOnlyWithSnr(false); }}
              className="rounded border-border"
            />
            Nur ohne S-Nr.
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyWithSnr}
              onChange={(e) => { setOnlyWithSnr(e.target.checked); if (e.target.checked) setOnlyUnassigned(false); }}
              className="rounded border-border"
            />
            Nur mit S-Nr.
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wide">Schiff</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Quelle</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">ETA</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Vorh. ETA</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Δ ETA</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">ETD</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Terminal</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Abgerufen</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">S-Nr.</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Container</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Listen-Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-10 text-muted-foreground text-sm">
                  Keine Daten gefunden
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row, i) => {
                const key = row.vessel_name_normalized;
                const assigned = shipmentByVessel[key] ?? [];
                const containers = containerByVessel[key] ?? [];
                const days = row.eta_change_days;
                const isPositive = days != null && days > 0;
                const isNegative = days != null && days < 0;

                return (
                  <TableRow key={`${row.vessel_name}-${row.source}-${row.scraped_at}-${i}`}>
                    <TableCell className="font-semibold text-sm">{row.vessel_name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs',
                          row.source === 'eurogate'
                            ? 'text-sky-400 border-sky-500/30'
                            : 'text-emerald-400 border-emerald-500/30'
                        )}
                      >
                        {row.source === 'eurogate' ? 'Eurogate' : 'HHLA'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{formatDateTime(row.eta)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(row.previous_eta)}</TableCell>
                    <TableCell>
                      {days == null || days === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', isPositive ? 'text-red-400' : 'text-emerald-400')}>
                          {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {isPositive ? '+' : ''}{days}d
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(row.etd)}</TableCell>
                    <TableCell className="text-sm">{row.terminal ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(row.scraped_at)}</TableCell>
                    <TableCell>
                      {assigned.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {assigned.map((snr) => (
                            <Badge key={snr} variant="secondary" className="font-mono text-xs px-1.5 py-0">
                              {snr}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {containers.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {containers.map((c) => (
                            <Badge key={c} variant="outline" className="font-mono text-xs px-1.5 py-0">
                              {c}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{listSourceByVessel[key] ?? '—'}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
