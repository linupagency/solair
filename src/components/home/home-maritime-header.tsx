import Link from "next/link";

export type HomeNavLink = {
  label: string;
  href: string;
};

type HomeMaritimeHeaderProps = {
  topLinks: HomeNavLink[];
  mainLinks: HomeNavLink[];
  reservationHref: string;
};

/**
 * En-tête style compagnie maritime : blanc, horizontal, sobre.
 */
export function HomeMaritimeHeader({
  topLinks,
  mainLinks,
  reservationHref,
}: HomeMaritimeHeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col px-3 sm:px-5 lg:px-8">
        <div className="hidden items-center justify-end gap-5 border-b border-slate-100 py-2 text-xs text-slate-500 lg:flex">
          {topLinks.map((link) => (
            <Link
              key={`${link.label}-${link.href}`}
              href={link.href}
              className="font-medium transition hover:text-[#163B6D] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#163B6D]/30 focus-visible:ring-offset-2"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-3.5">
          <Link
            href="/"
            className="flex shrink-0 items-center focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#163B6D]/35 focus-visible:ring-offset-2"
            aria-label="Accueil Solair Voyages"
          >
            <img
              src="/logo-solair-voyages.png"
              alt="Solair Voyages"
              className="h-9 w-auto sm:h-10"
            />
          </Link>

          <nav
            className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-semibold text-[#163B6D] sm:flex-1"
            aria-label="Navigation principale"
          >
            {mainLinks.map((link) => (
              <Link
                key={`${link.label}-${link.href}`}
                href={link.href}
                className="rounded-sm px-0.5 py-1 transition hover:text-[#0f2d55] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#163B6D]/30 focus-visible:ring-offset-2"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <Link
            href={reservationHref}
            className="inline-flex min-h-[44px] items-center justify-center rounded border border-slate-300 bg-white px-4 py-2 text-center text-sm font-semibold text-[#163B6D] transition hover:border-[#163B6D] hover:bg-slate-50 focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#163B6D]/35 focus-visible:ring-offset-2 sm:min-h-0"
          >
            Retrouver ma réservation
          </Link>
        </div>
      </div>
    </header>
  );
}
