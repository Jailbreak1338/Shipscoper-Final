import type { Metadata } from 'next';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import './globals.css';
import { AppSidebar } from '@/components/AppSidebar';

export const metadata: Metadata = {
  title: 'Shipscoper – Kein manuelles ETA-Tracking mehr',
  description: 'Automatische Vessel-ETAs für Hamburg und Bremerhaven. Direkt in deinen Workflow.',
  icons: { icon: '/favicon.png' },
  openGraph: {
    images: ['/og-image.png'],
  },
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userIsAdmin = user ? await isAdmin(user.id) : false;

  return (
    <html lang="de" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {user ? (
          <div className="flex h-screen overflow-hidden">
            <AppSidebar
              userEmail={user.email ?? ''}
              isAdmin={userIsAdmin}
            />
            <main className="flex-1 overflow-y-auto bg-background">
              {children}
            </main>
          </div>
        ) : (
          <main>{children}</main>
        )}
      </body>
    </html>
  );
}
