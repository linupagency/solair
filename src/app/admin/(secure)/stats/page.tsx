import { listAdminSales } from "@/lib/admin-sales";

export const dynamic = "force-dynamic";

function formatMoney(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";

  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export default async function AdminStatsPage() {
  const { stats } = await listAdminSales();

  return (
    <main className="mx-auto flex w-full max-w-[1700px] flex-col gap-6 px-4 py-8 sm:px-6 xl:px-10">
      <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-6 xl:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#a38c78]">
          Administration
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#3a2d26]">
          Statistiques
        </h2>
        <p className="mt-2 text-sm text-[#8d7764]">
          Indicateurs principaux calculés depuis les dossiers disponibles.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[24px] border border-[#eadfd3] bg-white px-5 py-5 shadow-[0_12px_24px_rgb(80_61_43/0.05)]">
          <p className="text-sm font-medium text-[#8d7764]">Confirmées</p>
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
          <p className="text-sm font-medium text-[#8d7764]">CA du jour</p>
          <p className="mt-2 text-3xl font-semibold text-[#9b7225]">
            {formatMoney(stats.revenueToday)}
          </p>
        </article>
        <article className="rounded-[24px] border border-[#eadfd3] bg-white px-5 py-5 shadow-[0_12px_24px_rgb(80_61_43/0.05)]">
          <p className="text-sm font-medium text-[#8d7764]">CA du mois</p>
          <p className="mt-2 text-3xl font-semibold text-[#9b7225]">
            {formatMoney(stats.revenueMonth)}
          </p>
        </article>
      </section>
    </main>
  );
}
