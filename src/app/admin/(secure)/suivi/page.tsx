import Link from "next/link";
import { listAdminSales } from "@/lib/admin-sales";

export const dynamic = "force-dynamic";

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

function statusLabel(status: "draft" | "reserved") {
  return status === "reserved" ? "Réservée" : "Brouillon";
}

function statusClasses(status: "draft" | "reserved") {
  return status === "reserved"
    ? "bg-[#e9f0ff] text-[#4267d6]"
    : "bg-[#fce9e6] text-[#c94c3d]";
}

export default async function AdminTrackingPage() {
  const { sales } = await listAdminSales();

  return (
    <main className="mx-auto flex w-full max-w-[1700px] flex-col gap-6 px-4 py-8 sm:px-6 xl:px-10">
      <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-6 xl:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#a38c78]">
          Administration
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#3a2d26]">
          Suivi
        </h2>
        <p className="mt-2 text-sm text-[#8d7764]">
          Historique récent des dossiers visibles dans l&apos;application.
        </p>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-[#eadfd3] bg-white shadow-[0_18px_38px_rgb(80_61_43/0.08)]">
        <div className="divide-y divide-[#f0e5db]">
          {sales.slice(0, 20).map((sale) => (
            <div
              key={sale.id}
              className="flex flex-col gap-3 px-5 py-5 sm:px-6 xl:flex-row xl:items-center xl:justify-between"
            >
              <div>
                <p className="font-semibold text-[#2f2826]">
                  {sale.customerName} • {sale.origen} → {sale.destino}
                </p>
                <p className="mt-1 text-sm text-[#8d7764]">
                  {sale.codigoLocata || sale.id}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold ${statusClasses(
                    sale.status
                  )}`}
                >
                  {statusLabel(sale.status)}
                </span>
                <span className="text-sm text-[#8d7764]">
                  {formatDateTime(sale.updatedAt)}
                </span>
                <Link
                  href={`/admin/ventes/${sale.id}`}
                  className="rounded-2xl bg-[#b63524] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#9f2f20]"
                >
                  Voir
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
