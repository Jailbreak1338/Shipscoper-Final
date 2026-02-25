import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LandingShell from '@/components/LandingShell';
import WaitlistForm from '@/components/WaitlistForm';
import FeatureCards from '@/components/FeatureCards';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    redirect('/eta-updater');
  }

  return (
    <LandingShell>
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-24 pb-32 sm:pt-36 sm:pb-44">
        {/* Animated grid background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-x-0 top-[-60px] h-[calc(100%+60px)] animate-grid-drift landing-grid" />
          {/* Radial glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-signal/5 blur-3xl" />
          {/* Fade to solid at bottom */}
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0D1117] to-transparent" />
        </div>

        <div className="relative mx-auto max-w-3xl px-4 sm:px-6 text-center">
          {/* Live badge */}
          <div className="animate-fade-up mb-7 inline-flex items-center gap-2.5 rounded-full border border-signal/20 bg-signal/5 px-4 py-1.5 text-sm text-signal">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-pulse-ring absolute inline-flex h-full w-full rounded-full bg-signal/60" />
              <span className="animate-pulse-dot relative inline-flex h-2 w-2 rounded-full bg-signal" />
            </span>
            Live · Eurogate & HHLA Hamburg
          </div>

          {/* Headline */}
          <h1 className="animate-fade-up delay-200 mb-6 text-4xl sm:text-5xl lg:text-[3.5rem] font-bold tracking-tight leading-[1.1]">
            Kein manuelles<br />
            <span className="text-signal">ETA-Tracking</span> mehr.
          </h1>

          {/* Sub-headline */}
          <p className="animate-fade-up delay-400 mb-10 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Shipscoper verbindet sich direkt mit Eurogate &amp; HHLA —
            vessel ETAs, Container-Status und Excel-Export vollautomatisch,
            ohne Copy-Paste.
          </p>

          {/* Waitlist form */}
          <div className="animate-fade-up delay-600 flex justify-center">
            <WaitlistForm />
          </div>

          {/* Stats row */}
          <div className="animate-fade-up delay-800 mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs text-muted-foreground">
            <span>2 Terminals</span>
            <span className="hidden sm:block h-3 w-px bg-white/10" />
            <span>Stündliche Updates</span>
            <span className="hidden sm:block h-3 w-px bg-white/10" />
            <span>Kostenlose Warteliste</span>
          </div>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-4 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">
              Alles was du brauchst
            </h2>
            <p className="text-muted-foreground">
              Ein Tool für alle Hafendaten.
            </p>
          </div>
          <FeatureCards />
        </div>
      </section>

      {/* ── BOTTOM CTA ───────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-4 sm:px-6">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            Bereit loszulegen?
          </h2>
          <p className="text-muted-foreground mb-8">
            Trage dich in die Warteliste ein und erhalte frühzeitigen Zugang.
          </p>
          <div className="flex justify-center">
            <WaitlistForm />
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
