'use client';

import Link from 'next/link';
import Logo from '@/components/Logo';
import { usePathname, useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import {
  Upload,
  LayoutDashboard,
  Eye,
  Package,
  Search,
  ShieldCheck,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: '/eta-updater', label: 'ETA Upload', icon: Upload },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/watchlist', label: 'Watchlist', icon: Eye },
  { href: '/sendungen', label: 'Sendungen', icon: Package },
  { href: '/schedule-search', label: 'Suche', icon: Search },
  { href: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true },
];

interface AppSidebarProps {
  userEmail: string;
  isAdmin: boolean;
}

export function AppSidebar({ userEmail, isAdmin }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClientComponentClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-sidebar border-sidebar-border shrink-0">
      {/* Logo */}
      <div className="flex items-center px-5 py-4 border-b border-sidebar-border">
        <Logo size="md" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        <p className="px-2 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Navigation
        </p>
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors cursor-pointer group',
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                  )}
                />
                <span className="flex-1">{item.label}</span>
                {isActive && (
                  <ChevronRight className="h-3 w-3 text-primary opacity-60" />
                )}
                {item.adminOnly && (
                  <span className="text-xs px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold">
                    ADM
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-sidebar-border px-3 py-3">
        <div className="flex items-center gap-2 rounded-md px-2 py-2 mb-1">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground uppercase">
            {userEmail.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{userEmail}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent text-xs h-8"
        >
          <LogOut className="h-3.5 w-3.5" />
          Abmelden
        </Button>
      </div>
    </aside>
  );
}
