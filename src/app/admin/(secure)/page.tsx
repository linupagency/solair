import Link from "next/link";
import { listAdminSales } from "@/lib/admin-sales";

export const dynamic = "force-dynamic";

type AdminPageProps = {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    trip?: string;
  }>;
};

type FilterStatus = "all" | "reserved" | "draft";
type FilterTrip = "all" | "round_trip" | "one_way";

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

function formatDeparture(dateValue?: string, timeValue?: string) {
  const safeDate = dateValue || "-";
  const safeTime = timeValue
    ? `${timeValue.slice(0, 2)}:${timeValue.slice(2, 4)}`
    : "-";

  return `${safeDate} ${safeTime}`;
}

function statusLabel(status: "draft" | "reserved") {
  return status === "reserved" ? "Réservée" : "Brouillon";
}

function statusClasses(status: "draft" | "reserved") {
  return status === "reserved"
    ? "bg-[#e9f0ff] text-[#4267d6]"
    : "bg-[#fce9e6] text-[#c94c3d]";
}

function paymentLabel(status: string) {
  switch (status) {
    case "created":
      return "Paiement créé";
    case "captured":
      return "Paiement capturé";
    case "reservation_pending":
      return "Finalisation dossier";
    case "reserved":
      return "Payé et réservé";
    case "failed":
      return "Paiement en échec";
    case "denied":
      return "Paiement refusé";
    case "reversed":
      return "Paiement annulé";
    case "test_mode":
      return "Mode test";
    default:
      return "Sans paiement";
  }
}

function paymentClasses(status: string) {
  switch (status) {
    case "captured":
    case "reserved":
      return "bg-[#eef6eb] text-[#3f7f4a]";
    case "reservation_pending":
      return "bg-[#fff7e7] text-[#a27018]";
    case "failed":
    case "denied":
    case "reversed":
      return "bg-[#fce9e6] text-[#c94c3d]";
    case "created":
      return "bg-[#f4f1ff] text-[#6d4fd7]";
    default:
      return "bg-[#f8f3ec] text-[#6f5e50]";
  }
}

function isStatusFilter(value: string): value is FilterStatus {
  return value === "all" || value === "reserved" || value === "draft";
}

function isTripFilter(value: string): value is FilterTrip {
  return value === "all" || value === "round_trip" || value === "one_way";
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const query = resolvedSearchParams?.q?.trim() || "";
  const requestedStatus = resolvedSearchParams?.status?.trim() || "all";
  const requestedTrip = resolvedSearchParams?.trip?.trim() || "all";
  const status = isStatusFilter(requestedStatus) ? requestedStatus : "all";
  const trip = isTripFilter(requestedTrip) ? requestedTrip : "all";

  const { sales, stats, configError } = await listAdminSales(query);

  const filteredSales = sales.filter((sale) => {
    if (status !== "all" && sale.status !== status) {
      return false;
    }

    if (trip !== "all" && sale.tripType !== trip) {
      return false;
    }

    return true;
  });

  return (
    <main className="mx-auto flex w-full max-w-[1700px] flex-col gap-6 px-4 py-8 sm:px-6 xl:px-10">
        <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-6 xl:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#a38c78]">
                Administration
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#3a2d26]">
                Gestion des réservations
              </h2>
              <p className="mt-2 text-sm text-[#8d7764]">
                Consulte les dossiers, retrouve un client et ouvre la fiche
                complète d&apos;une réservation.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 text-sm font-semibold">
              <span className="rounded-2xl bg-[#f8f3ec] px-4 py-2 text-[#6f5e50]">
                Affichées {filteredSales.length}
              </span>
              <span className="rounded-2xl bg-[#eef6eb] px-4 py-2 text-[#3f7f4a]">
                Réservées {stats.totalReservedSales}
              </span>
              <span className="rounded-2xl bg-[#fbefe7] px-4 py-2 text-[#b86439]">
                Brouillons {stats.totalDraftSales}
              </span>
              <span className="rounded-2xl bg-[#fff7e7] px-4 py-2 text-[#a27018]">
                Paiement capturé sans dossier {stats.totalCapturedPendingReservation}
              </span>
              <span className="rounded-2xl bg-[#fff7e7] px-4 py-2 text-[#a27018]">
                CA mois {formatMoney(stats.revenueMonth)}
              </span>
            </div>
          </div>

          {configError ? (
            <div className="mt-5 rounded-3xl border border-[#f3d5cc] bg-[#fff1ed] px-4 py-4 text-sm text-[#9d4b38]">
              <p className="font-semibold">Configuration requise</p>
              <p className="mt-1">{configError}</p>
            </div>
          ) : null}

          <form
            action="/admin"
            className="mt-6 grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_220px]"
          >
            <label className="flex items-center gap-3 rounded-2xl border border-[#e9ddd0] bg-white px-4 py-4 text-[#7a685b] shadow-[0_6px_18px_rgb(79_59_42/0.04)]">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Rechercher un client, une référence ou un trajet..."
                className="w-full bg-transparent text-[1.02rem] text-[#2f2826] outline-none placeholder:text-[#a69284]"
              />
            </label>

            <label className="flex items-center rounded-2xl border border-[#e9ddd0] bg-white px-4 py-4 shadow-[0_6px_18px_rgb(79_59_42/0.04)]">
              <select
                name="status"
                defaultValue={status}
                className="w-full bg-transparent text-[1.02rem] font-medium text-[#2f2826] outline-none"
              >
                <option value="all">Tous statuts</option>
                <option value="reserved">Réservées</option>
                <option value="draft">Brouillons</option>
              </select>
            </label>

            <div className="flex gap-3">
              <label className="flex min-w-0 flex-1 items-center rounded-2xl border border-[#e9ddd0] bg-white px-4 py-4 shadow-[0_6px_18px_rgb(79_59_42/0.04)]">
                <select
                  name="trip"
                  defaultValue={trip}
                  className="w-full bg-transparent text-[1.02rem] font-medium text-[#2f2826] outline-none"
                >
                  <option value="all">Tous trajets</option>
                  <option value="round_trip">Aller-retour</option>
                  <option value="one_way">Aller simple</option>
                </select>
              </label>

              <button
                type="submit"
                className="rounded-2xl bg-[#b63524] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#9f2f20]"
              >
                Filtrer
              </button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-[#eadfd3] bg-white shadow-[0_18px_38px_rgb(80_61_43/0.08)]">
          <div className="hidden grid-cols-[2fr_1.4fr_1.6fr_1.4fr_1fr_1.5fr_1.1fr_64px] items-center gap-4 border-b border-[#eee1d4] bg-[#f6f1ea] px-5 py-5 text-sm font-semibold text-[#8a7564] xl:grid">
            <span>Référence</span>
            <span>Client</span>
            <span>Trajet</span>
            <span>Départ</span>
            <span>Total</span>
            <span>Statuts</span>
            <span>Date</span>
            <span />
          </div>

          {filteredSales.length === 0 ? (
            <div className="px-5 py-14 text-center text-sm text-[#8d7764]">
              Aucun dossier ne correspond à cette recherche.
            </div>
          ) : (
            <div className="divide-y divide-[#f0e5db]">
              {filteredSales.map((sale) => (
                <article
                  key={sale.id}
                  className="xl:grid xl:grid-cols-[2fr_1.4fr_1.6fr_1.4fr_1fr_1.5fr_1.1fr_64px] xl:items-center xl:gap-4 xl:px-5 xl:py-5"
                >
                  <div className="grid gap-4 px-5 py-5 xl:contents">
                    <div>
                      <p className="text-[1.03rem] font-semibold text-[#2f2826]">
                        {sale.codigoLocata || sale.id}
                      </p>
                      <p className="mt-1 text-sm text-[#9a8575]">
                        {sale.inboundCodigoLocata
                          ? `Retour ${sale.inboundCodigoLocata}`
                          : `ID ${sale.id.slice(0, 8).toUpperCase()}`}
                      </p>
                    </div>

                    <div>
                      <p className="text-[1.02rem] font-semibold text-[#2f2826]">
                        {sale.customerName}
                      </p>
                      <p className="mt-1 truncate text-sm text-[#8d7764]">
                        {sale.customerEmail || "Email non renseigné"}
                      </p>
                    </div>

                    <div>
                      <p className="text-[1.02rem] font-medium text-[#2f2826]">
                        {sale.origen} → {sale.destino}
                      </p>
                      <p className="mt-1 text-sm text-[#8d7764]">
                        {sale.tripType === "round_trip"
                          ? "Aller-retour"
                          : "Aller simple"}
                      </p>
                    </div>

                    <div>
                      <p className="text-[1.02rem] font-medium text-[#2f2826]">
                        {formatDeparture(sale.fechaSalida, sale.horaSalida)}
                      </p>
                      <p className="mt-1 text-sm text-[#8d7764]">
                        {sale.passengersCount} passager
                        {sale.passengersCount > 1 ? "s" : ""} • {sale.vehiclesCount} véhicule
                        {sale.vehiclesCount > 1 ? "s" : ""}
                      </p>
                    </div>

                    <div>
                      <p className="text-[1.12rem] font-semibold text-[#9b7225]">
                        {formatMoney(sale.totalAmount)}
                      </p>
                    </div>

                    <div>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`inline-flex rounded-full px-3 py-1.5 text-sm font-semibold ${statusClasses(
                            sale.status
                          )}`}
                        >
                          {statusLabel(sale.status)}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-3 py-1.5 text-sm font-semibold ${paymentClasses(
                            sale.paymentStatus
                          )}`}
                        >
                          {paymentLabel(sale.paymentStatus)}
                        </span>
                      </div>
                    </div>

                    <div>
                      <p className="text-[1rem] font-medium text-[#6b5b4f]">
                        {formatDateTime(sale.createdAt)}
                      </p>
                    </div>

                    <div>
                      <Link
                        href={`/admin/ventes/${sale.id}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#2f2826] transition hover:bg-[#f5eee6]"
                        aria-label={`Voir la réservation ${sale.codigoLocata || sale.id}`}
                      >
                        <EyeIcon />
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
  );
}
