import { listAdminSales } from "@/lib/admin-sales";

export const dynamic = "force-dynamic";

function formatMoney(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";

  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export default async function AdminRoutesPage() {
  const { stats } = await listAdminSales();

  return (
    <main className="mx-auto flex w-full max-w-[1700px] flex-col gap-6 px-4 py-8 sm:px-6 xl:px-10">
      <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-6 xl:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#a38c78]">
          Administration
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#3a2d26]">
          Trajets
        </h2>
        <p className="mt-2 text-sm text-[#8d7764]">
          Classement des trajets les plus vendus selon les dossiers disponibles.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {stats.topRoutes.map((route, index) => (
          <article
            key={route.route}
            className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-5 shadow-[0_18px_38px_rgb(80_61_43/0.08)]"
          >
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#a38c78]">
              Top {index + 1}
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-[#2f2826]">
              {route.route}
            </h3>
            <p className="mt-3 text-sm text-[#8d7764]">
              {route.count} vente{route.count > 1 ? "s" : ""}
            </p>
            <p className="mt-2 text-xl font-semibold text-[#9b7225]">
              {formatMoney(route.revenue)}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
