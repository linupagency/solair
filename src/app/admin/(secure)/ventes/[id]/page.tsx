import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSaleById } from "@/lib/admin-sales";

export const dynamic = "force-dynamic";

type AdminSaleDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

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

function formatApiDate(value?: string) {
  if (!value) return "-";

  if (/^\d{8}$/.test(value)) {
    return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
  }

  return value;
}

function formatApiTime(value?: string) {
  if (!value || value.length !== 4) return value || "-";
  return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
}

function formatMoney(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";

  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function documentTypeLabel(code: string) {
  switch (code) {
    case "P":
      return "Passeport";
    case "D":
      return "Carte d'identité";
    case "T":
      return "Titre de résidence";
    default:
      return code || "-";
  }
}

function passengerTypeLabel(code: string) {
  switch (code) {
    case "A":
      return "Adulte";
    case "J":
      return "Jeune";
    case "M":
      return "Senior";
    case "N":
      return "Enfant";
    case "B":
      return "Bébé";
    default:
      return code || "-";
  }
}

function genderLabel(code: string) {
  switch (code) {
    case "H":
      return "Homme";
    case "M":
      return "Femme";
    default:
      return code || "-";
  }
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

function SectionCard({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description?: string;
  children: React.ReactNode;
}>) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-[#eadfd3] bg-white shadow-[0_18px_38px_rgb(80_61_43/0.08)]">
      <div className="border-b border-[#f0e5db] bg-[#f6f1ea] px-5 py-4 sm:px-6">
        <h2 className="text-[1.15rem] font-semibold text-[#3a2d26]">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-[#8d7764]">{description}</p>
        ) : null}
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

function InfoBox({
  label,
  value,
  accent = false,
}: Readonly<{
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}>) {
  return (
    <div
      className={`rounded-[22px] border px-4 py-4 ${
        accent
          ? "border-[#ead8bf] bg-[#fff8ee]"
          : "border-[#eadfd3] bg-[#fcfaf7]"
      }`}
    >
      <p className="text-sm font-medium text-[#8d7764]">{label}</p>
      <div className="mt-2 text-[1.05rem] font-semibold text-[#2f2826]">
        {value}
      </div>
    </div>
  );
}

export default async function AdminSaleDetailPage({
  params,
}: AdminSaleDetailPageProps) {
  const { id } = await params;
  const sale = await getAdminSaleById(id);

  if (!sale) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-[1700px] flex-col gap-6 px-4 py-8 sm:px-6 xl:px-10">
      <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-6 xl:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#a38c78]">
              Réservations
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#3a2d26]">
              Détail de la réservation
            </h2>
            <p className="mt-2 text-sm text-[#8d7764]">
              Référence {sale.codigoLocata || sale.id} • vue complète du dossier
              client.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
            <span
              className={`rounded-full px-4 py-2 ${statusClasses(sale.status)}`}
            >
              {statusLabel(sale.status)}
            </span>
            <span className="rounded-full bg-[#f8f3ec] px-4 py-2 text-[#6f5e50]">
              {sale.tripType === "round_trip" ? "Aller-retour" : "Aller simple"}
            </span>
            <Link
              href="/admin"
              className="rounded-2xl bg-[#b63524] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#9f2f20]"
            >
              Retour à la liste
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <InfoBox
          label="Référence"
          value={sale.codigoLocata || sale.id.slice(0, 8).toUpperCase()}
        />
        <InfoBox
          label="Montant total"
          value={formatMoney(sale.totalAmount)}
          accent
        />
        <InfoBox
          label="Trajet"
          value={`${sale.origen} → ${sale.destino}`}
        />
        <InfoBox
          label="Départ"
          value={`${formatApiDate(sale.fechaSalida)} ${formatApiTime(
            sale.horaSalida
          )}`}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <SectionCard
            title="Informations client"
            description="Coordonnées utilisées pour la réservation."
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <InfoBox label="Nom" value={sale.customerName} />
              <InfoBox label="Email" value={sale.customerEmail || "-"} />
              <InfoBox label="Téléphone" value={sale.customerPhone || "-"} />
            </div>
          </SectionCard>

          <SectionCard
            title="Informations trajet"
            description="Résumé du voyage et des références associées."
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <InfoBox label="Origine" value={sale.origen || "-"} />
              <InfoBox label="Destination" value={sale.destino || "-"} />
              <InfoBox
                label="Type de voyage"
                value={sale.tripType === "round_trip" ? "Aller-retour" : "Aller simple"}
              />
              <InfoBox
                label="Date aller"
                value={`${formatApiDate(sale.fechaSalida)} ${formatApiTime(
                  sale.horaSalida
                )}`}
              />
              <InfoBox label="Date retour" value={formatApiDate(sale.fechaVuelta)} />
              <InfoBox
                label="Locata retour"
                value={sale.inboundCodigoLocata || "-"}
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Voyageurs"
            description="Identités enregistrées dans le dossier."
          >
            <div className="space-y-4">
              {sale.travelers.length === 0 ? (
                <p className="text-sm text-[#8d7764]">
                  Aucun voyageur enregistré dans ce dossier.
                </p>
              ) : (
                sale.travelers.map((traveler, index) => (
                  <article
                    key={`${traveler.codigoDocumento}-${index}`}
                    className="rounded-[24px] border border-[#eadfd3] bg-[#fcfaf7] px-4 py-4"
                  >
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#a38c78]">
                          Voyageur {index + 1}
                        </p>
                        <p className="mt-2 text-[1.15rem] font-semibold text-[#2f2826]">
                          {[traveler.nombre, traveler.apellido1, traveler.apellido2]
                            .filter(Boolean)
                            .join(" ")}
                        </p>
                        <p className="mt-1 text-sm text-[#8d7764]">
                          {passengerTypeLabel(traveler.tipoPasajero)} •{" "}
                          {genderLabel(traveler.sexo)} • {traveler.codigoPais || "-"}
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <InfoBox
                          label="Document"
                          value={documentTypeLabel(traveler.tipoDocumento)}
                        />
                        <InfoBox
                          label="N° document"
                          value={traveler.codigoDocumento || "-"}
                        />
                        <InfoBox
                          label="Naissance"
                          value={formatApiDate(traveler.fechaNacimiento)}
                        />
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Véhicules"
            description="Véhicules déclarés pour cette réservation."
          >
            <div className="space-y-4">
              {sale.vehicles.length === 0 ? (
                <p className="text-sm text-[#8d7764]">Aucun véhicule sur ce dossier.</p>
              ) : (
                sale.vehicles.map((vehicle, index) => (
                  <article
                    key={`${vehicle.vehicleCategory}-${index}`}
                    className="rounded-[24px] border border-[#eadfd3] bg-[#fcfaf7] px-4 py-4"
                  >
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#a38c78]">
                      Véhicule {index + 1}
                    </p>
                    <p className="mt-2 text-[1.15rem] font-semibold text-[#2f2826]">
                      {vehicle.vehicle || vehicle.vehicleCategory}
                    </p>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <InfoBox
                        label="Catégorie"
                        value={vehicle.vehicleCategory || "-"}
                      />
                      <InfoBox
                        label="Marque / modèle"
                        value={
                          [
                            vehicle.vehicleData?.marque,
                            vehicle.vehicleData?.modele,
                          ]
                            .filter(Boolean)
                            .join(" ") || "-"
                        }
                      />
                      <InfoBox
                        label="Immatriculation"
                        value={vehicle.vehicleData?.immatriculation || "-"}
                      />
                      <InfoBox
                        label="Conducteur"
                        value={`Passager ${
                          Number(vehicle.vehicleData?.conducteurIndex || 0) + 1
                        }`}
                      />
                    </div>
                  </article>
                ))
              )}
            </div>
          </SectionCard>
        </div>

        <aside className="flex flex-col gap-6">
          <SectionCard
            title="Références et statuts"
            description="Repères utiles pour le suivi administratif."
          >
            <div className="space-y-4">
              <InfoBox label="Locata aller" value={sale.codigoLocata || "-"} />
              <InfoBox
                label="Locata retour"
                value={sale.inboundCodigoLocata || "-"}
              />
              <InfoBox label="Code métier" value={sale.businessCode || "-"} />
              <div className="rounded-[22px] border border-[#eadfd3] bg-[#fcfaf7] px-4 py-4">
                <p className="text-sm font-medium text-[#8d7764]">Statuts</p>
                <div className="mt-2 flex flex-wrap gap-2">
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
            </div>
          </SectionCard>

          <SectionCard
            title="Paiement et notifications"
            description="Traçabilité PayPal et état des emails envoyés."
          >
            <div className="space-y-4">
              <InfoBox label="Order ID PayPal" value={sale.paypalOrderId || "-"} />
              <InfoBox label="Capture ID PayPal" value={sale.paypalCaptureId || "-"} />
              <InfoBox
                label="Montant PayPal"
                value={
                  sale.paypalAmount
                    ? `${sale.paypalAmount} ${sale.paypalCurrency || "EUR"}`
                    : "-"
                }
              />
              <InfoBox
                label="Statut ordre / capture"
                value={
                  [sale.paypalOrderStatus, sale.paypalCaptureStatus]
                    .filter(Boolean)
                    .join(" / ") || "-"
                }
              />
              <InfoBox
                label="Emails"
                value={
                  sale.emailStatus === "sent"
                    ? `Envoyés le ${formatDateTime(sale.emailSentAt)}`
                    : sale.emailStatus === "failed"
                      ? "Échec d’envoi"
                      : sale.emailStatus === "pending"
                        ? "En attente"
                        : "-"
                }
              />
              {(sale.paymentLastError || sale.emailError) && (
                <div className="rounded-[22px] border border-[#f3d5cc] bg-[#fff1ed] px-4 py-4 text-sm text-[#9d4b38]">
                  <p className="font-semibold">Point de vigilance</p>
                  {sale.paymentLastError ? (
                    <p className="mt-2">Paiement : {sale.paymentLastError}</p>
                  ) : null}
                  {sale.emailError ? (
                    <p className="mt-2">Emails : {sale.emailError}</p>
                  ) : null}
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Journal dossier"
            description="Dates utiles de création et de mise à jour."
          >
            <div className="space-y-4">
              <InfoBox label="Créé le" value={formatDateTime(sale.createdAt)} />
              <InfoBox label="Mis à jour le" value={formatDateTime(sale.updatedAt)} />
              <InfoBox
                label="Dernière mise à jour paiement"
                value={formatDateTime(sale.paymentUpdatedAt)}
              />
            </div>
          </SectionCard>
        </aside>
      </section>
    </main>
  );
}
