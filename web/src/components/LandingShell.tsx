import Link from 'next/link';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import Logo from '@/components/Logo';

export default async function LandingShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return (
    <div className="min-h-screen bg-[#0D1117] text-white flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0D1117]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="shrink-0">
            <Logo size="md" />
          </Link>

          <nav className="flex items-center gap-5">
            {session ? (
              <Link
                href="/eta-updater"
                className="text-sm font-medium text-signal hover:text-signal/80 transition-colors"
              >
                Dashboard →
              </Link>
            ) : (
              <Link
                href="/login"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Anmelden
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-4">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Tim Kimmich · Shipscoper</p>
          <div className="flex gap-6">
            <Link
              href="/impressum"
              className="hover:text-foreground transition-colors"
            >
              Impressum
            </Link>
            <Link
              href="/datenschutz"
              className="hover:text-foreground transition-colors"
            >
              Datenschutz
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
