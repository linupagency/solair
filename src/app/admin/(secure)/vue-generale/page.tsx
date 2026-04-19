import Link from "next/link";
import { listAdminSales } from "@/lib/admin-sales";

export const dynamic = "force-dynamic";

function formatMoney(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";

  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDateTime(value?: string) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function AdminOverviewPage() {
  const { sales, stats } = await listAdminSales();
  const recentSales = sales.slice(0, 6);

  return (
    <main className="mx-auto flex w-full max-w-[1700px] flex-col gap-6 px-4 py-8 sm:px-6 xl:px-10">
      <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-6 xl:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#a38c78]">
          Administration
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#3a2d26]">
          Vue générale
        </h2>
        <p className="mt-2 text-sm text-[#8d7764]">
          Synthèse rapide de l&apos;activité récente et des indicateurs clés.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[24px] border border-[#eadfd3] bg-white px-5 py-5 shadow-[0_12px_24px_rgb(80_61_43/0.05)]">
          <p className="text-sm font-medium text-[#8d7764]">Réservations confirmées</p>
          <p className="mt-2 text-3xl font-semibold text-[#2f2826]">
            {stats.totalReservedSales}
          </p>
        </article>
        <article className="rounded-[24px] border border-[#eadfd3] bg-white px-5 py-5 shadow-[0_12px_24px_rgb(80_61_43/0.05)]">
          <p className="text-sm font-medium text-[#8d7764]">Brouillons</p>
          <p className="mt-2 text-3xl font-semibold text-[#2f2826]">
            {stats.totalDraftSales}
          </p>
        </article>
        <article className="rounded-[24px] border border-[#eadfd3] bg-white px-5 py-5 shadow-[0_12px_24px_rgb(80_61_43/0.05)]">
          <p className="text-sm font-medium text-[#8d7764]">CA du mois</p>
          <p className="mt-2 text-3xl font-semibold text-[#9b7225]">
            {formatMoney(stats.revenueMonth)}
          </p>
        </article>
        <article className="rounded-[24px] border border-[#eadfd3] bg-white px-5 py-5 shadow-[0_12px_24px_rgb(80_61_43/0.05)]">
          <p className="text-sm font-medium text-[#8d7764]">Panier moyen</p>
          <p className="mt-2 text-3xl font-semibold text-[#2f2826]">
            {formatMoney(stats.averageBasket)}
          </p>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-[28px] border border-[#eadfd3] bg-white shadow-[0_18px_38px_rgb(80_61_43/0.08)]">
          <div className="border-b border-[#f0e5db] bg-[#f6f1ea] px-5 py-4 sm:px-6">
            <h3 className="text-[1.15rem] font-semibold text-[#3a2d26]">
              Dernières réservations
            </h3>
          </div>
          <div className="divide-y divide-[#f0e5db]">
            {recentSales.map((sale) => (
              <div
                key={sale.id}
                className="flex flex-col gap-3 px-5 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between"
              >
                <div>
                  <p className="font-semibold text-[#2f2826]">
                    {sale.customerName}
                  </p>
                  <p className="mt-1 text-sm text-[#8d7764]">
                    {sale.origen} → {sale.destino}
                  </p>
                </div>
                <div className="text-sm text-[#8d7764]">{formatDateTime(sale.createdAt)}</div>
                <div className="font-semibold text-[#9b7225]">
                  {formatMoney(sale.totalAmount)}
                </div>
                <Link
                  href={`/admin/ventes/${sale.id}`}
                  className="rounded-2xl bg-[#b63524] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#9f2f20]"
                >
                  Ouvrir
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-[#eadfd3] bg-white shadow-[0_18px_38px_rgb(80_61_43/0.08)]">
          <div className="border-b border-[#f0e5db] bg-[#f6f1ea] px-5 py-4 sm:px-6">
            <h3 className="text-[1.15rem] font-semibold text-[#3a2d26]">
              Trajets principaux
            </h3>
          </div>
          <div className="space-y-4 px-5 py-5 sm:px-6">
            {stats.topRoutes.map((route) => (
              <div
                key={route.route}
                className="rounded-[22px] border border-[#eadfd3] bg-[#fcfaf7] px-4 py-4"
              >
                <p className="font-semibold text-[#2f2826]">{route.route}</p>
                <p className="mt-1 text-sm text-[#8d7764]">
                  {route.count} vente{route.count > 1 ? "s" : ""} •{" "}
                  {formatMoney(route.revenue)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
