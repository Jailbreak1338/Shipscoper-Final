'use client';

import { useState, useEffect } from 'react';
import { PlayCircle, Loader2, CheckCircle2, XCircle, Clock, Users, Upload, Ship, Zap, LayoutDashboard, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

interface ScraperRun {
  id: string;
  status: 'running' | 'success' | 'failed';
  vessels_scraped: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  errors: string | null;
}

function formatDuration(ms: number | null) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
}

const STATUS_MAP = {
  success: { label: 'Erfolg', icon: CheckCircle2, className: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  failed:  { label: 'Fehler', icon: XCircle,      className: 'text-red-400 border-red-500/30 bg-red-500/10' },
  running: { label: 'Läuft',  icon: Loader2,       className: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
} as const;

export default function AdminDashboardPage() {
  const [lastRun, setLastRun] = useState<ScraperRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchLastRun = async () => {
    try {
      const res = await fetch('/api/admin/trigger-scraper', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setLastRun(data.last_run);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchLastRun(); }, []);

  useEffect(() => {
    if (lastRun?.status !== 'running') return;
    const timer = setInterval(fetchLastRun, 10_000);
    return () => clearInterval(timer);
  }, [lastRun?.status]);

  const handleTriggerScraper = async () => {
    if (!confirm('Scraper jetzt starten? Aktuelle ETAs werden von Eurogate und HHLA abgerufen.')) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/trigger-scraper', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({
          type: 'success',
          text: data.message || `Scraper erfolgreich. ${data.vessels_scraped} Vessels (${data.eurogate_scraped ?? 0} Eurogate + ${data.hhla_scraped ?? 0} HHLA).`,
        });
        fetchLastRun();
      } else {
        setMessage({ type: 'error', text: data.error || 'Scraper fehlgeschlagen' });
        fetchLastRun();
      }
    } catch {
      setMessage({ type: 'error', text: 'Netzwerkfehler beim Starten' });
    } finally {
      setLoading(false);
    }
  };

  const runCfg = lastRun ? (STATUS_MAP[lastRun.status] ?? STATUS_MAP.failed) : null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Scraper-Kontrolle und Systemverwaltung</p>
      </div>

      {/* Scraper Control */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-primary" />
            Scraper Control
          </CardTitle>
          <CardDescription>Python-Scraper manuell starten — Eurogate + HHLA ETAs abrufen.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleTriggerScraper} disabled={loading} className="gap-2">
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" />Scraper läuft…</>
              : <><PlayCircle className="h-4 w-4" />Scraper jetzt starten</>
            }
          </Button>

          {message && (
            <Alert variant={message.type === 'success' ? 'default' : 'destructive'}>
              {message.type === 'success'
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                : <XCircle className="h-4 w-4" />
              }
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )}

          {lastRun && runCfg && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Letzter Scraper-Lauf</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Status</p>
                  <Badge variant="outline" className={cn('gap-1', runCfg.className)}>
                    <runCfg.icon className={cn('h-3 w-3', lastRun.status === 'running' && 'animate-spin')} />
                    {runCfg.label}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Vessels</p>
                  <p className="font-semibold text-foreground">{lastRun.vessels_scraped}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Gestartet</p>
                  <p className="text-foreground">{fmtDateTime(lastRun.started_at)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Dauer</p>
                  <p className="font-semibold text-foreground">{formatDuration(lastRun.duration_ms)}</p>
                </div>
              </div>
              {lastRun.errors && (
                <pre className="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded p-3 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                  {lastRun.errors}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Links */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Schnellzugriff</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { href: '/admin/users', icon: Users,           title: 'Benutzerverwaltung', desc: 'Benutzer erstellen und verwalten' },
            { href: '/dashboard',  icon: LayoutDashboard,  title: 'Dashboard',          desc: 'Statistiken und Upload-Verlauf' },
            { href: '/eta-updater', icon: FileSpreadsheet, title: 'ETA Updater',        desc: 'Excel hochladen und verarbeiten' },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 hover:bg-accent hover:border-primary/30 transition-colors"
            >
              <link.icon className="h-5 w-5 text-muted-foreground group-hover:text-primary mt-0.5 shrink-0 transition-colors" />
              <div>
                <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{link.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{link.desc}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
