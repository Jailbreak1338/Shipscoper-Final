import Link from 'next/link';
import LandingShell from '@/components/LandingShell';

export const metadata = {
  title: 'Impressum – Shipscoper',
};

export default function ImpressumPage() {
  return (
    <LandingShell>
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-16 sm:py-24">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-10"
        >
          ← Zurück
        </Link>

        <h1 className="text-3xl font-bold mb-10">Impressum</h1>

        <div className="space-y-8 text-sm text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Angaben gemäß § 5 TMG
            </h2>
            <p>
              Tim Kimmich<br />
              Hindenburgstr. 34<br />
              73728 Esslingen
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Kontakt
            </h2>
            <p>
              E-Mail: hello@shipscoper.com
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV
            </h2>
            <p>
              Tim Kimmich<br />
              (Anschrift wie oben)
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Haftungsausschluss
            </h2>
            <p>
              Die Inhalte dieser Website wurden mit größtmöglicher Sorgfalt
              erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der
              Inhalte übernehmen wir keine Gewähr.
            </p>
          </section>
        </div>
      </div>
    </LandingShell>
  );
}
