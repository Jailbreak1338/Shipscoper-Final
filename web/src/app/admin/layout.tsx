import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  if (roleData?.role !== 'admin') {
    redirect('/eta-updater');
  }

  return (
    <div>
      <nav
        style={{
          backgroundColor: '#f8f9fa',
          padding: '12px 24px',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            display: 'flex',
            gap: '24px',
            alignItems: 'center',
          }}
        >
          <a
            href="/admin"
            style={{
              fontWeight: 600,
              color: '#0066cc',
              textDecoration: 'none',
              fontSize: '14px',
            }}
          >
            Admin
          </a>
          <span style={{ color: '#d1d5db' }}>|</span>
          <a
            href="/admin/users"
            style={{
              color: '#666',
              textDecoration: 'none',
              fontSize: '14px',
            }}
          >
            Users
          </a>
          <span style={{ color: '#d1d5db' }}>|</span>
          <a
            href="/dashboard"
            style={{
              color: '#666',
              textDecoration: 'none',
              fontSize: '14px',
            }}
          >
            Dashboard
          </a>
          <span style={{ color: '#d1d5db' }}>|</span>
          <a
            href="/eta-updater"
            style={{
              color: '#666',
              textDecoration: 'none',
              fontSize: '14px',
            }}
          >
            ETA Updater
          </a>
        </div>
      </nav>
      {children}
    </div>
  );
}
