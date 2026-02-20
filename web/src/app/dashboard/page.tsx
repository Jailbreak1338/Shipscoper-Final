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

export default async function DashboardPage() {
  const supabase = createServerComponentClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect('/login');
  }

  // Use service-role client to bypass RLS for the role check
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

  // Get user's upload history
  const { data: userUploads, error: uploadsError } = await supabase
    .from('upload_logs')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (uploadsError) {
    console.error('Dashboard: failed to fetch upload_logs:', uploadsError);
  }

  const uploads = (userUploads as UploadLog[] | null) ?? [];

  // User stats
  const totalUploads = uploads.length;
  const totalMatched = uploads.reduce((s, l) => s + l.matched_count, 0);
  const totalUnmatched = uploads.reduce((s, l) => s + l.unmatched_count, 0);
  const totalRows = totalMatched + totalUnmatched;
  const successRate =
    totalRows > 0 ? Math.round((totalMatched / totalRows) * 100) : 0;

  // Unique shipment numbers
  const allShipmentNumbers = new Set<string>();
  for (const log of uploads) {
    if (log.shipment_numbers) {
      for (const num of log.shipment_numbers) {
        allShipmentNumbers.add(num);
      }
    }
  }

  // Admin stats
  let adminStats: {
    totalUsers: number;
    totalUploads: number;
    totalVessels: number;
    avgProcessingTime: number;
  } | null = null;

  if (isAdmin) {
    const [usersRes, uploadsRes, vesselsRes] = await Promise.all([
      supabase.from('user_roles').select('user_id'),
      supabase
        .from('upload_logs')
        .select('processing_time_ms')
        .order('created_at', { ascending: false }),
      supabase.from('vessels').select('id'),
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
  }

  return (
    <div style={styles.container}>
      <AutoRefresh intervalMs={15000} />
      <h1 style={styles.pageTitle}>Dashboard</h1>

      {/* User Stats */}
      <div style={styles.grid3}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Meine Uploads</div>
          <div style={styles.statValue}>{totalUploads}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Erfolgsrate</div>
          <div style={{ ...styles.statValue, color: '#0066cc' }}>
            {successRate}%
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Sendungsnummern</div>
          <div style={styles.statValue}>{allShipmentNumbers.size}</div>
        </div>
      </div>

      {/* Admin Stats */}
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
        </>
      )}

      {/* Upload History */}
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
                  <td style={styles.td}>
                    {log.shipment_numbers?.length ?? 0}
                  </td>
                  <td style={{ ...styles.td, color: '#666', fontSize: '13px' }}>
                    {log.processing_time_ms ?? '-'}ms
                  </td>
                  <td style={{ ...styles.td, color: '#666', fontSize: '13px' }}>
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
                    color: '#888',
                  }}
                >
                  Noch keine Uploads.{' '}
                  <a
                    href="/eta-updater"
                    style={{ color: '#0066cc', textDecoration: 'none' }}
                  >
                    Jetzt starten
                  </a>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Quick Actions */}
      <div style={{ marginTop: '32px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <a href="/eta-updater" style={styles.btnPrimary}>
          Excel hochladen
        </a>
        {isAdmin && (
          <a href="/admin/users" style={styles.btnSecondary}>
            Benutzerverwaltung
          </a>
        )}
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
    backgroundColor: '#fff',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  adminCard: {
    backgroundColor: '#f0f7ff',
    border: '1px solid #dbeafe',
    padding: '20px',
    borderRadius: '10px',
  },
  statLabel: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '6px',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 700,
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
  btnPrimary: {
    display: 'inline-block',
    padding: '12px 24px',
    backgroundColor: '#0066cc',
    color: '#fff',
    borderRadius: '8px',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '14px',
  },
  btnSecondary: {
    display: 'inline-block',
    padding: '12px 24px',
    backgroundColor: '#f3f4f6',
    color: '#333',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    textDecoration: 'none',
    fontWeight: 500,
    fontSize: '14px',
  },
};
