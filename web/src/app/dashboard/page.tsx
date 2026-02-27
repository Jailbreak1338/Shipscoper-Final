import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import AutoRefresh from '@/components/AutoRefresh';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

interface UploadLog {
  id: string;
  filename: string;
  file_size_bytes: number;
  matched_count: number;
  unmatched_count: number;
  total_rows: number;
  shipment_numbers: string[] | null;
  processing_time_ms: number | null;
  created_at: string;
}

interface EtaHistoryRow {
  vessel_id: string;
  source: string;
  eta: string | null;
  scraped_at: string;
  vessels: { name: string } | { name: string }[] | null;
}

interface EtaTrendPoint {
  date: string;
  avgChangeDays: number;
  samples: number;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
}

function toDayDiff(nextEta: string | null, previousEta: string | null): number | null {
  if (!nextEta || !previousEta) return null;
  const nextTs = Date.parse(nextEta);
  const prevTs = Date.parse(previousEta);
  if (Number.isNaN(nextTs) || Number.isNaN(prevTs)) return null;
  return Math.round((nextTs - prevTs) / 86_400_000);
}

function buildEtaTrend(rows: EtaHistoryRow[]): EtaTrendPoint[] {
  const previousByKey = new Map<string, string | null>();
  const aggregate = new Map<string, { sum: number; count: number }>();
  const ordered = [...rows].sort((a, b) => new Date(a.scraped_at).getTime() - new Date(b.scraped_at).getTime());
  for (const row of ordered) {
    const key = `${row.vessel_id}|${row.source}`;
    const previousEta = previousByKey.get(key) ?? null;
    const diff = toDayDiff(row.eta, previousEta);
    if (diff != null) {
      const day = row.scraped_at.slice(0, 10);
      const existing = aggregate.get(day) ?? { sum: 0, count: 0 };
      existing.sum += diff;
      existing.count += 1;
      aggregate.set(day, existing);
    }
    previousByKey.set(key, row.eta);
  }
  return Array.from(aggregate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([date, value]) => ({
      date,
      avgChangeDays: Number((value.sum / Math.max(1, value.count)).toFixed(2)),
      samples: value.count,
    }));
}

function buildSparkline(points: EtaTrendPoint[]): string {
  if (points.length === 0) return '';
  const values = points.map((p) => p.avgChangeDays);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.1, max - min);
  return points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 100;
      const y = 100 - ((point.avgChangeDays - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');
}

export default async function DashboardPage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: roleData } = await adminClient
    .from('user_roles').select('role').eq('user_id', user.id).single();
  const isAdmin = (roleData as { role: string } | null)?.role === 'admin';

  const { data: userUploads } = await adminClient
    .from('upload_logs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const uploads = (userUploads as UploadLog[] | null) ?? [];
  const totalUploads = uploads.length;
  const totalMatched = uploads.reduce((s, l) => s + l.matched_count, 0);
  const totalUnmatched = uploads.reduce((s, l) => s + l.unmatched_count, 0);
  const totalRows = totalMatched + totalUnmatched;
  const successRate = totalRows > 0 ? Math.round((totalMatched / totalRows) * 100) : 0;

  const allShipmentNumbers = new Set<string>();
  for (const log of uploads) {
    if (log.shipment_numbers) {
      for (const num of log.shipment_numbers) allShipmentNumbers.add(num);
    }
  }

  let adminStats: { totalUsers: number; totalUploads: number; totalVessels: number; avgProcessingTime: number } | null = null;
  let etaTrend: EtaTrendPoint[] = [];
  let etaHistoryPreview: Array<{ vesselName: string; source: string; eta: string | null; scraped_at: string }> = [];

  if (isAdmin) {
    const [usersRes, uploadsRes, vesselsRes, etaEventsRes] = await Promise.all([
      supabase.from('user_roles').select('user_id'),
      adminClient.from('upload_logs').select('processing_time_ms').order('created_at', { ascending: false }),
      supabase.from('vessels').select('id'),
      adminClient.from('schedule_events').select('vessel_id, source, eta, scraped_at, vessels(name)').order('scraped_at', { ascending: false }).limit(5000),
    ]);

    const allUploads = (uploadsRes.data as { processing_time_ms: number | null }[] | null) ?? [];
    const avgTime = allUploads.length > 0
      ? Math.round(allUploads.reduce((s, l) => s + (l.processing_time_ms ?? 0), 0) / allUploads.length)
      : 0;

    adminStats = {
      totalUsers: usersRes.data?.length ?? 0,
      totalUploads: allUploads.length,
      totalVessels: vesselsRes.data?.length ?? 0,
      avgProcessingTime: avgTime,
    };

    const etaRows = (etaEventsRes.data as EtaHistoryRow[] | null) ?? [];
    etaTrend = buildEtaTrend(etaRows);
    etaHistoryPreview = etaRows.slice(0, 20).map((row) => ({
      vesselName: Array.isArray(row.vessels) ? (row.vessels[0]?.name ?? '-') : (row.vessels?.name ?? '-'),
      source: row.source,
      eta: row.eta,
      scraped_at: row.scraped_at,
    }));
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <AutoRefresh intervalMs={15000} />

      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Übersicht deiner Uploads und Systemaktivität</p>
      </div>

      {/* User Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Meine Uploads</p>
            <p className="text-3xl font-bold text-foreground">{totalUploads}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Erfolgsrate</p>
            <p className={cn('text-3xl font-bold', successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-amber-400' : 'text-red-400')}>
              {successRate}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Sendungsnummern</p>
            <p className="text-3xl font-bold text-foreground">{allShipmentNumbers.size}</p>
          </CardContent>
        </Card>
      </div>

      {/* Admin Stats */}
      {isAdmin && adminStats && (
        <>
          <div>
            <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
              System
              <Badge variant="outline" className="text-amber-400 border-amber-500/30 text-xs">Admin</Badge>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Benutzer', value: adminStats.totalUsers },
                { label: 'Alle Uploads', value: adminStats.totalUploads },
                { label: 'Vessels in DB', value: adminStats.totalVessels },
                { label: 'Ø Verarbeitung', value: `${adminStats.avgProcessingTime}ms` },
              ].map((s) => (
                <Card key={s.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{s.label}</p>
                    <p className="text-2xl font-bold text-foreground">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* ETA Trend Chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">ETA-Verlauf</CardTitle>
              <CardDescription>Ø Tage Änderung pro Scrape-Tag (letzte 30 Tage)</CardDescription>
            </CardHeader>
            <CardContent>
              {etaTrend.length > 0 ? (
                <>
                  <svg
                    viewBox="0 0 100 40"
                    preserveAspectRatio="none"
                    className="w-full h-28 rounded-md border border-border/50"
                    style={{ background: 'hsl(var(--muted)/0.3)' }}
                  >
                    <polyline
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={buildSparkline(etaTrend)}
                    />
                  </svg>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
                    {etaTrend.slice(-6).map((point) => (
                      <span key={point.date} className="text-xs text-muted-foreground">
                        {formatDate(point.date)}:{' '}
                        <span className={cn('font-semibold', point.avgChangeDays > 0 ? 'text-red-400' : 'text-emerald-400')}>
                          {point.avgChangeDays > 0 ? '+' : ''}{point.avgChangeDays}d
                        </span>{' '}
                        <span className="opacity-60">({point.samples})</span>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground py-4">Noch zu wenig ETA-Historie für den Graphen.</p>
              )}
            </CardContent>
          </Card>

          {/* ETA History Preview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Letzte ETA-Werte</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vessel</TableHead>
                    <TableHead>Quelle</TableHead>
                    <TableHead>ETA</TableHead>
                    <TableHead>Scrape-Zeit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {etaHistoryPreview.length > 0 ? (
                    etaHistoryPreview.map((row, idx) => (
                      <TableRow key={`${row.vesselName}-${row.source}-${row.scraped_at}-${idx}`}>
                        <TableCell className="font-medium text-sm">{row.vesselName}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn('text-xs capitalize', row.source === 'hhla' ? 'text-emerald-400 border-emerald-500/30' : 'text-sky-400 border-sky-500/30')}
                          >
                            {row.source}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.eta ? new Date(row.eta).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(row.scraped_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-6 text-sm">
                        Keine ETA-Historie gefunden.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* Upload Log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Letzte Uploads</CardTitle>
          <CardDescription>Deine letzten 10 Datei-Uploads</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datei</TableHead>
                <TableHead>Matched</TableHead>
                <TableHead>Unmatched</TableHead>
                <TableHead>Sendungen</TableHead>
                <TableHead>Zeit</TableHead>
                <TableHead>Datum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uploads.length > 0 ? (
                uploads.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm font-medium max-w-48 truncate">{log.filename}</TableCell>
                    <TableCell>
                      <span className="text-emerald-400 font-semibold text-sm">{log.matched_count}</span>
                    </TableCell>
                    <TableCell>
                      <span className={cn('font-semibold text-sm', log.unmatched_count > 0 ? 'text-red-400' : 'text-muted-foreground')}>
                        {log.unmatched_count}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{log.shipment_numbers?.length ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{log.processing_time_ms ?? '—'}ms</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                    Noch keine Uploads.{' '}
                    <a href="/eta-updater" className="text-primary hover:underline">
                      Jetzt starten
                    </a>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
