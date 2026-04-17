import Link from "next/link";

type PromoCard = {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  priceLabel: string;
  price: string;
  priceHint: string;
  borderClass: string;
  accentBg: string;
  ctaClass: string;
  href: string;
  /** Placeholder visuel (île / mer) — remplacer par une image réelle si disponible */
  visualClass: string;
};

const PROMO_CARDS: PromoCard[] = [
  {
    id: "early",
    eyebrow: "Offre du moment",
    title: "Réservez tôt",
    subtitle: "Places limitées sur les traversées les plus demandées.",
    priceLabel: "À partir de",
    price: "49 €",
    priceHint: "par personne, selon trajet",
    borderClass: "border-[#163B6D]/35",
    accentBg: "bg-[#163B6D]",
    ctaClass:
      "bg-[#C41E3A] text-white hover:bg-[#a91830] focus-visible:ring-[#C41E3A]/40",
    href: "#reservation-form",
    visualClass:
      "bg-gradient-to-br from-sky-200 via-sky-100 to-[#163B6D]/25 [background-image:radial-gradient(circle_at_30%_20%,rgb(255_255_255/0.5),transparent_55%)]",
  },
  {
    id: "family",
    eyebrow: "Famille",
    title: "Tarifs avantageux",
    subtitle: "Voyagez à plusieurs avec des conditions claires.",
    priceLabel: "Dès",
    price: "39 €",
    priceHint: "selon disponibilités",
    borderClass: "border-amber-400/50",
    accentBg: "bg-amber-500",
    ctaClass:
      "bg-[#163B6D] text-white hover:bg-[#0f2d55] focus-visible:ring-[#163B6D]/40",
    href: "#reservation-form",
    visualClass:
      "bg-gradient-to-br from-amber-100 via-orange-50 to-amber-200/80 [background-image:radial-gradient(circle_at_70%_30%,rgb(255_255_255/0.6),transparent_50%)]",
  },
  {
    id: "vehicle",
    eyebrow: "Véhicule",
    title: "Embarquez votre voiture",
    subtitle: "Dimensions et catégories conformes au réseau.",
    priceLabel: "À partir de",
    price: "89 €",
    priceHint: "véhicule + passagers, selon ligne",
    borderClass: "border-sky-400/45",
    accentBg: "bg-sky-600",
    ctaClass:
      "bg-[#F28C28] text-white hover:bg-[#e57c12] focus-visible:ring-[#F28C28]/40",
    href: "#reservation-form",
    visualClass:
      "bg-gradient-to-br from-slate-200 via-sky-100 to-[#163B6D]/20 [background-image:radial-gradient(circle_at_50%_80%,rgb(255_255_255/0.45),transparent_55%)]",
  },
];

function PromoCardView({ card }: { card: PromoCard }) {
  return (
    <article
      className={`flex min-h-[420px] flex-col overflow-hidden rounded-xl border-2 bg-white shadow-sm ${card.borderClass}`}
    >
      <div className={`relative h-36 shrink-0 sm:h-40 ${card.visualClass}`}>
        <div
          className={`absolute bottom-3 left-3 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white ${card.accentBg}`}
        >
          {card.eyebrow}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-xl font-bold leading-snug text-[#0f2744]">
          {card.title}
        </h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
          {card.subtitle}
        </p>
        <div className="mt-6 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {card.priceLabel}
          </p>
          <p className="mt-1 text-4xl font-black tabular-nums text-[#163B6D]">
            {card.price}
          </p>
          <p className="mt-1 text-xs text-slate-500">{card.priceHint}</p>
        </div>
        <Link
          href={card.href}
          className={`mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-md px-4 py-3 text-center text-sm font-bold transition focus-visible:outline focus-visible:ring-2 focus-visible:ring-offset-2 ${card.ctaClass}`}
        >
          Réservez !
        </Link>
      </div>
    </article>
  );
}

/**
 * Section promotionnelle sous le hero (placeholders commerciaux).
 */
export function HomePromoOffers() {
  return (
    <section className="border-t border-slate-200 bg-[#EEF1F5] pb-12 pt-10 sm:pb-16 sm:pt-14">
      <div className="mx-auto max-w-7xl px-3 sm:px-5 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#163B6D]">
            Promotions
          </p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
            Offres du moment sur vos traversées
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            Exemples d’accroches commerciales — à relier plus tard à vos vraies
            offres ou campagnes.
          </p>
        </div>

        <div
          className="mt-4 rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-center text-sm text-amber-950 sm:mt-6"
          role="status"
        >
          <span className="font-semibold">Info trajets :</span> vérifiez les
          dates disponibles et les ports directement dans le moteur ci-dessus.
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-5 lg:gap-8">
          {PROMO_CARDS.map((card) => (
            <PromoCardView key={card.id} card={card} />
          ))}
        </div>
      </div>
    </section>
  );
}
