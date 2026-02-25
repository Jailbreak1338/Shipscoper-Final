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
      className="px-3.5 py-1.5 text-sm text-muted-foreground border border-white/10 rounded-md hover:bg-white/5 hover:text-foreground transition-colors cursor-pointer"
    >
      Abmelden
    </button>
  );
}
