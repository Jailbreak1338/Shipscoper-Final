'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

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
    // In production some browser/app-router combinations can keep stale RSC payloads.
    // Force a hard reload every 4 refresh cycles as a safety net.
    if (refreshTick > 0 && refreshTick % 4 === 0) {
      window.location.reload();
    }
  }, [refreshTick]);

  return (
    <div style={styles.wrap}>
      <span>
        Letzte Aktualisierung: {lastRefresh.toLocaleTimeString('de-DE')}
      </span>
      <button
        type="button"
        style={styles.btn}
        onClick={() => {
          router.refresh();
          setLastRefresh(new Date());
        }}
      >
        Jetzt aktualisieren
      </button>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    marginBottom: '12px',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    color: '#64748b',
    fontSize: '13px',
  },
  btn: {
    border: '1px solid #cbd5e1',
    backgroundColor: '#fff',
    borderRadius: '6px',
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#334155',
  },
};
