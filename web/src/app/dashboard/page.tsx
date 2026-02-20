import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import AutoRefresh from '@/components/AutoRefresh';

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

  const ordered = [...rows].sort(
    (a, b) => new Date(a.scraped_at).getTime() - new Date(b.scraped_at).getTime()
  );

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

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect('/login');
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: roleData } = await adminClient
    .from('user_roles')
    .select('role')
    .eq('user_id', session.user.id)
    .single();

  const isAdmin = (roleData as { role: string } | null)?.role === 'admin';

  const { data: userUploads, error: uploadsError } = await adminClient
    .from('upload_logs')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (uploadsError) {
    console.error('Dashboard: failed to fetch upload_logs:', uploadsError);
  }

  const uploads = (userUploads as UploadLog[] | null) ?? [];

  const totalUploads = uploads.length;
  const totalMatched = uploads.reduce((s, l) => s + l.matched_count, 0);
  const totalUnmatched = uploads.reduce((s, l) => s + l.unmatched_count, 0);
  const totalRows = totalMatched + totalUnmatched;
  const successRate =
    totalRows > 0 ? Math.round((totalMatched / totalRows) * 100) : 0;

  const allShipmentNumbers = new Set<string>();
  for (const log of uploads) {
    if (log.shipment_numbers) {
      for (const num of log.shipment_numbers) {
        allShipmentNumbers.add(num);
      }
    }
  }

  let adminStats: {
    totalUsers: number;
    totalUploads: number;
    totalVessels: number;
    avgProcessingTime: number;
  } | null = null;
  let etaTrend: EtaTrendPoint[] = [];
  let etaHistoryPreview: Array<{
    vesselName: string;
    source: string;
    eta: string | null;
    scraped_at: string;
  }> = [];

  if (isAdmin) {
    const [usersRes, uploadsRes, vesselsRes, etaEventsRes] = await Promise.all([
      supabase.from('user_roles').select('user_id'),
      adminClient
        .from('upload_logs')
        .select('processing_time_ms')
        .order('created_at', { ascending: false }),
      supabase.from('vessels').select('id'),
      adminClient
        .from('schedule_events')
        .select('vessel_id, source, eta, scraped_at, vessels(name)')
        .order('scraped_at', { ascending: false })
        .limit(5000),
    ]);

    const allUploads = (uploadsRes.data as { processing_time_ms: number | null }[] | null) ?? [];
    const avgTime =
      allUploads.length > 0
        ? Math.round(
            allUploads.reduce((s, l) => s + (l.processing_time_ms ?? 0), 0) /
              allUploads.length
          )
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
    <div style={styles.container}>
      <AutoRefresh intervalMs={15000} />
      <h1 style={styles.pageTitle}>Dashboard</h1>

      <div style={styles.grid3}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Meine Uploads</div>
          <div style={styles.statValue}>{totalUploads}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Erfolgsrate</div>
          <div style={{ ...styles.statValue, color: '#0ea5e9' }}>
            {successRate}%
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Sendungsnummern</div>
          <div style={styles.statValue}>{allShipmentNumbers.size}</div>
        </div>
      </div>

      {isAdmin && adminStats && (
        <>
          <h2 style={styles.sectionTitle}>System (Admin)</h2>

          <div style={styles.grid4}>
            {[
              { label: 'Benutzer', value: adminStats.totalUsers },
              { label: 'Alle Uploads', value: adminStats.totalUploads },
              { label: 'Vessels in DB', value: adminStats.totalVessels },
              {
                label: 'Avg. Verarbeitung',
                value: `${adminStats.avgProcessingTime}ms`,
              },
            ].map((s) => (
              <div key={s.label} style={styles.adminCard}>
                <div style={styles.statLabel}>{s.label}</div>
                <div style={{ ...styles.statValue, fontSize: '24px' }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          <h3 style={styles.sectionSubTitle}>ETA-Verlauf (Ø Tage Änderung pro Scrape-Tag)</h3>
          <div style={styles.chartCard}>
            {etaTrend.length > 0 ? (
              <>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={styles.chartSvg}>
                  <polyline
                    fill="none"
                    stroke="#0ea5e9"
                    strokeWidth="2"
                    points={buildSparkline(etaTrend)}
                  />
                </svg>
                <div style={styles.chartLegend}>
                  {etaTrend.slice(-6).map((point) => (
                    <span key={point.date}>
                      {formatDate(point.date)}: {point.avgChangeDays > 0 ? '+' : ''}
                      {point.avgChangeDays} Tage ({point.samples})
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div style={styles.emptyInfo}>Noch zu wenig ETA-Historie für den Graphen.</div>
            )}
          </div>

          <h3 style={styles.sectionSubTitle}>Alte ETA-Werte (aus Datenbank)</h3>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Vessel</th>
                  <th style={styles.th}>Quelle</th>
                  <th style={styles.th}>ETA</th>
                  <th style={styles.th}>Scrape-Zeit</th>
                </tr>
              </thead>
              <tbody>
                {etaHistoryPreview.length > 0 ? (
                  etaHistoryPreview.map((row, idx) => (
                    <tr key={`${row.vesselName}-${row.source}-${row.scraped_at}-${idx}`}>
                      <td style={styles.td}>{row.vesselName}</td>
                      <td style={styles.td}>{row.source}</td>
                      <td style={styles.td}>{row.eta ? new Date(row.eta).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : '-'}</td>
                      <td style={styles.td}>{new Date(row.scraped_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} style={{ ...styles.td, textAlign: 'center', color: '#888' }}>
                      Keine ETA-Historie gefunden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 style={styles.sectionTitle}>Letzte Uploads</h2>
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Datei</th>
              <th style={styles.th}>Matched</th>
              <th style={styles.th}>Unmatched</th>
              <th style={styles.th}>Sendungen</th>
              <th style={styles.th}>Zeit</th>
              <th style={styles.th}>Datum</th>
            </tr>
          </thead>
          <tbody>
            {uploads.length > 0 ? (
              uploads.map((log) => (
                <tr key={log.id}>
                  <td style={styles.td}>{log.filename}</td>
                  <td style={{ ...styles.td, color: '#15803d', fontWeight: 600 }}>
                    {log.matched_count}
                  </td>
                  <td style={{ ...styles.td, color: '#b91c1c', fontWeight: 600 }}>
                    {log.unmatched_count}
                  </td>
                  <td style={styles.td}>{log.shipment_numbers?.length ?? 0}</td>
                  <td style={styles.tdMuted}>{log.processing_time_ms ?? '-'}ms</td>
                  <td style={styles.tdMuted}>
                    {new Date(log.created_at).toLocaleString('de-DE', {
                      timeZone: 'Europe/Berlin',
                    })}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    ...styles.td,
                    textAlign: 'center',
                    padding: '32px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Noch keine Uploads.{' '}
                  <a
                    href="/eta-updater"
                    style={{ color: '#0ea5e9', textDecoration: 'none' }}
                  >
                    Jetzt starten
                  </a>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
    margin: '0 0 24px',
    fontSize: '24px',
    fontWeight: 700,
  },
  sectionTitle: {
    margin: '32px 0 16px',
    fontSize: '18px',
    fontWeight: 600,
  },
  sectionSubTitle: {
    margin: '20px 0 10px',
    fontSize: '15px',
    fontWeight: 700,
  },
  grid3: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
  },
  grid4: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '12px',
  },
  statCard: {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    padding: '24px',
    borderRadius: '12px',
  },
  adminCard: {
    backgroundColor: 'var(--surface-muted)',
    border: '1px solid var(--border)',
    padding: '20px',
    borderRadius: '10px',
  },
  statLabel: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    marginBottom: '6px',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 700,
  },
  chartCard: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    padding: '14px',
    marginBottom: '14px',
  },
  chartSvg: {
    width: '100%',
    height: '180px',
    background: 'linear-gradient(180deg, #f8fafc, #ffffff)',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },
  chartLegend: {
    marginTop: '8px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    fontSize: '12px',
    color: '#475569',
  },
  emptyInfo: {
    fontSize: '13px',
    color: '#64748b',
  },
  tableWrap: {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
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
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--border)',
    fontSize: '14px',
  },
  tdMuted: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--border)',
    fontSize: '13px',
    color: 'var(--text-secondary)',
  },
};
