import Link from 'next/link';
import LandingShell from '@/components/LandingShell';

export const metadata = {
  title: 'Datenschutz – Shipscoper',
};

export default function DatenschutzPage() {
  return (
    <LandingShell>
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-16 sm:py-24">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-10"
        >
          ← Zurück
        </Link>

        <h1 className="text-3xl font-bold mb-10">Datenschutzerklärung</h1>

        <div className="space-y-8 text-sm text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              1. Verantwortlicher
            </h2>
            <p>
              Verantwortlicher im Sinne der DSGVO ist:<br />
              Tim Kimmich, Hindenburgstr. 34, 73728 Esslingen<br />
              E-Mail: hello@shipscoper.com
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              2. Erhobene Daten
            </h2>
            <p>
              Bei der Registrierung für die Warteliste wird Ihre E-Mail-Adresse
              gespeichert. Diese wird ausschließlich zur Information über den
              Produktstart verwendet und nicht an Dritte weitergegeben.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              3. Hosting & Infrastruktur
            </h2>
            <p>
              Diese Website wird auf Servern von Vercel Inc. (USA) gehostet.
              Die Datenbank wird von Supabase (EU-Region) betrieben. Es gelten
              die Datenschutzbestimmungen der jeweiligen Anbieter.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              4. Cookies & Tracking
            </h2>
            <p>
              Diese Website verwendet ausschließlich technisch notwendige
              Cookies (Sitzungs-Cookies für die Authentifizierung). Es werden
              keine Tracking- oder Analyse-Tools eingesetzt.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              5. Ihre Rechte
            </h2>
            <p>
              Sie haben das Recht auf Auskunft, Berichtigung, Löschung und
              Einschränkung der Verarbeitung Ihrer Daten. Wenden Sie sich dazu
              per E-Mail an: hello@shipscoper.com
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              6. Aktualität
            </h2>
            <p>Stand: Februar 2026</p>
          </section>
        </div>
      </div>
    </LandingShell>
  );
}
