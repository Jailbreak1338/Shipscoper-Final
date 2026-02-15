'use client';

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();
  const supabase = createClientComponentClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <button
      onClick={handleLogout}
      style={{
        padding: '6px 14px',
        backgroundColor: 'transparent',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '13px',
        color: '#fff',
      }}
    >
      Abmelden
    </button>
  );
}
