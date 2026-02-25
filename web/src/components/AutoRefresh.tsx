'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

export default function AutoRefresh({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      router.refresh();
      setLastRefresh(new Date());
      setRefreshTick((t) => t + 1);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, router]);

  useEffect(() => {
    if (refreshTick > 0 && refreshTick % 4 === 0) {
      window.location.reload();
    }
  }, [refreshTick]);

  return (
    <div className="flex items-center gap-3 mb-5 text-xs text-muted-foreground">
      <span>Letzte Aktualisierung: {lastRefresh.toLocaleTimeString('de-DE')}</span>
      <button
        type="button"
        onClick={() => { router.refresh(); setLastRefresh(new Date()); }}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <RefreshCw className="h-3 w-3" />
        Aktualisieren
      </button>
    </div>
  );
}
