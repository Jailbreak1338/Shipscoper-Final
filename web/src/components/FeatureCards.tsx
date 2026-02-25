'use client';

import { useEffect, useRef } from 'react';
import { Ship, Bell, FileSpreadsheet } from 'lucide-react';

const features = [
  {
    icon: Ship,
    title: 'Automatische Vessel-ETAs',
    description:
      'Direkte Verbindung zu Eurogate und HHLA. Vessel-ETAs werden stündlich aktualisiert – ohne manuelle Recherche auf Terminalportalen.',
  },
  {
    icon: Bell,
    title: 'Container-Benachrichtigungen',
    description:
      'Automatische Alerts bei Statuswechseln: DISCHARGED → READY → DELIVERED. Immer informiert, nie hinterher.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Excel-Export',
    description:
      'Upload deiner Seefracht-Tabelle – Shipscoper füllt ETAs per Fuzzy-Matching automatisch ein und gibt die fertige Datei zurück.',
  },
];

export default function FeatureCards() {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    refs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {features.map((f, i) => (
        <div
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className="feature-card rounded-xl border border-white/10 bg-white/[0.03] p-6 hover:border-signal/30 hover:bg-white/[0.06] transition-colors duration-300"
          style={{ animationDelay: `${i * 0.15}s` }}
        >
          <div className="mb-4 inline-flex rounded-lg bg-signal/10 p-2.5">
            <f.icon className="h-5 w-5 text-signal" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-2">{f.title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
        </div>
      ))}
    </div>
  );
}
