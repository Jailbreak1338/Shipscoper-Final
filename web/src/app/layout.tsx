import type { Metadata } from 'next';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import LogoutButton from '@/components/LogoutButton';
import ThemeToggle from '@/components/ThemeToggle';
import ThemeInitializer from '@/components/ThemeInitializer';
import './globals.css';

export const metadata: Metadata = {
  title: 'Shipscoper by Tim Kimmich',
  description: 'Shipscoper by Tim Kimmich',
};

export const dynamic = 'force-dynamic';

async function isAdmin(userId: string): Promise<boolean> {
  const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
  const admin = getSupabaseAdmin();

  const { data } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  return (data as { role: string } | null)?.role === 'admin';
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userIsAdmin = session ? await isAdmin(session.user.id) : false;

  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          backgroundColor: 'var(--bg-app)',
          color: 'var(--text-primary)',
          minHeight: '100vh',
        }}
      >
        <ThemeInitializer />
        {session && (
          <header
            style={{
              backgroundColor: 'var(--header-bg)',
              color: '#fff',
              padding: '16px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  backgroundColor: '#0066cc',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold',
                  fontSize: '14px',
                }}
              >
                SK
              </div>
              <span style={{ fontSize: '18px', fontWeight: 600 }}>
                Shipscoper by Tim Kimmich
              </span>
              <nav style={{ display: 'flex', gap: '16px', marginLeft: '16px' }}>
                <a
                  href="/eta-updater"
                  style={{
                    color: 'var(--header-link)',
                    textDecoration: 'none',
                    fontSize: '14px',
                  }}
                >
                  Upload
                </a>
                <a
                  href="/dashboard"
                  style={{
                    color: 'var(--header-link)',
                    textDecoration: 'none',
                    fontSize: '14px',
                  }}
                >
                  Dashboard
                </a>
                <a
                  href="/watchlist"
                  style={{
                    color: 'var(--header-link)',
                    textDecoration: 'none',
                    fontSize: '14px',
                  }}
                >
                  Watchlist
                </a>
                <a
                  href="/sendungen"
                  style={{
                    color: 'var(--header-link)',
                    textDecoration: 'none',
                    fontSize: '14px',
                  }}
                >
                  Sendungen
                </a>
                <a
                  href="/schedule-search"
                  style={{
                    color: 'var(--header-link)',
                    textDecoration: 'none',
                    fontSize: '14px',
                  }}
                >
                  Suche
                </a>
                {userIsAdmin && (
                  <a
                    href="/admin"
                    style={{
                      color: '#fbbf24',
                      textDecoration: 'none',
                      fontSize: '14px',
                      fontWeight: 600,
                    }}
                  >
                    Admin
                  </a>
                )}
              </nav>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                }}
              >
                {session.user.email}
              </span>
              <ThemeToggle />
              <LogoutButton />
            </div>
          </header>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
