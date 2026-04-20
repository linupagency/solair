import Image from "next/image";
import Link from "next/link";

const FOOTER_LINKS = [
  { label: "Accueil", href: "https://solair-voyages.com" },
  { label: "Nos agences", href: "https://solair-voyages.com/nos-agences/" },
];

const CONTACT_HREF = "https://solair-voyages.com/contact/";

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-[#102d54] text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link
                href="/"
                className="inline-flex w-fit items-center rounded-xl focus-visible:outline focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#102d54]"
                aria-label="Accueil Solair Voyages"
              >
                <Image
                  src="/logo-solair-voyages.png"
                  alt="Solair Voyages"
                  width={220}
                  height={52}
                  className="h-11 w-auto sm:h-12"
                />
              </Link>

              <div className="hidden h-10 w-px bg-white/18 sm:block" />

              <div className="inline-flex w-fit items-center rounded-2xl border border-white/16 bg-white/8 px-3 py-3">
                <Image
                  src="/armastrasmediterranea.png"
                  alt="Armas Trasmediterránea"
                  width={150}
                  height={150}
                  className="h-14 w-auto rounded-lg object-contain"
                />
              </div>
            </div>

            <div className="max-w-2xl">
              <p className="text-base font-medium text-white/92">
                Traversées maritimes avec la compagnie Armas Trasmediterránea
              </p>
              <p className="mt-2 text-sm leading-6 text-white/68">
                Solair Voyages vous accompagne pour réserver vos traversées
                maritimes avec une expérience claire, fiable et pensée pour un
                accompagnement commercial humain.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6 lg:justify-end">
            <nav
              className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm font-semibold text-white/88"
              aria-label="Liens du pied de page"
            >
              {FOOTER_LINKS.map((link) => (
                <Link
                  key={`${link.label}-${link.href}`}
                  href={link.href}
                  className="transition hover:text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#102d54]"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <Link
              href={CONTACT_HREF}
              className="inline-flex min-h-[46px] items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#102d54] transition hover:bg-[#f4f7fb] focus-visible:outline focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#102d54]"
            >
              Nous contacter
            </Link>
          </div>
        </div>

        <div className="border-t border-white/12 pt-4 text-xs text-white/52">
          © Solair Voyages. Réservation de traversées maritimes.
        </div>
      </div>
    </footer>
  );
}
