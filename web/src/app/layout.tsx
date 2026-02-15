import type { Metadata } from 'next';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import LogoutButton from '@/components/LogoutButton';
import './globals.css';

export const metadata: Metadata = {
  title: 'ETA Automation',
  description: 'Vessel ETA Excel Updater',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          backgroundColor: '#f5f7fa',
          color: '#1a1a2e',
          minHeight: '100vh',
        }}
      >
        {session && (
          <header
            style={{
              backgroundColor: '#1a1a2e',
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
                ETA
              </div>
              <span style={{ fontSize: '18px', fontWeight: 600 }}>
                ETA Automation
              </span>
              <nav style={{ display: 'flex', gap: '16px', marginLeft: '16px' }}>
                <a
                  href="/eta-updater"
                  style={{
                    color: 'rgba(255,255,255,0.8)',
                    textDecoration: 'none',
                    fontSize: '14px',
                  }}
                >
                  Upload
                </a>
                <a
                  href="/dashboard"
                  style={{
                    color: 'rgba(255,255,255,0.8)',
                    textDecoration: 'none',
                    fontSize: '14px',
                  }}
                >
                  Dashboard
                </a>
                <a
                  href="/watchlist"
                  style={{
                    color: 'rgba(255,255,255,0.8)',
                    textDecoration: 'none',
                    fontSize: '14px',
                  }}
                >
                  Watchlist
                </a>
              </nav>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                style={{
                  fontSize: '13px',
                  color: 'rgba(255,255,255,0.6)',
                }}
              >
                {session.user.email}
              </span>
              <LogoutButton />
            </div>
          </header>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
