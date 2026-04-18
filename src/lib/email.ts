import { Resend } from "resend";

type Traveler = {
  nombre?: string;
  apellido1?: string;
  apellido2?: string;
  fechaNacimiento?: string;
  codigoPais?: string;
  sexo?: string;
  tipoDocumento?: string;
  codigoDocumento?: string;
};

type BookingConfirmationEmailInput = {
  to: string;
  codigoLocata: string;
  total: string;
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  travelers: Traveler[];
  /** Segment retour (deuxième locata Armas) */
  inboundLeg?: {
    codigoLocata: string;
    origen: string;
    destino: string;
    fechaSalida: string;
    horaSalida: string;
  };
  mode?: "live" | "test";
};

function formatApiDate(value?: string) {
  if (!value) return "-";

  if (value.length === 8 && /^\d{8}$/.test(value)) {
    return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
  }

  if (value.length === 10 && value.includes("-")) {
    const [yyyy, mm, dd] = value.split("-");
    if (yyyy && mm && dd) return `${dd}/${mm}/${yyyy}`;
  }

  return value;
}

function formatApiTime(value?: string) {
  if (!value || value.length !== 4) return value || "-";
  return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
}

function formatAmount(value?: string) {
  const v = (value || "").trim();
  if (!v) return "-";
  if (v.includes("€") || v.toUpperCase().includes("EUR")) return v;
  return `${v} €`;
}

function getTravelerFullName(traveler: Traveler) {
  return [traveler.nombre, traveler.apellido1, traveler.apellido2]
    .filter(Boolean)
    .join(" ");
}

function buildTravelersHtml(travelers: Traveler[]) {
  if (!travelers.length) {
    return `<p style="margin:0;color:#334155;">Aucun voyageur transmis.</p>`;
  }

  return travelers
    .map((traveler, index) => {
      const fullName = getTravelerFullName(traveler) || "-";
      const birthDate = formatApiDate(traveler.fechaNacimiento);
      const documentNumber = traveler.codigoDocumento || "-";

      return `
        <div style="border:1px solid #e2e8f0;border-radius:16px;padding:16px;margin-top:12px;background:#ffffff;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;font-weight:700;">
            Voyageur ${index + 1}
          </div>
          <div style="margin-top:8px;font-size:18px;font-weight:700;color:#0f172a;">
            ${fullName}
          </div>
          <div style="margin-top:6px;font-size:14px;color:#475569;">
            Date de naissance : ${birthDate}
          </div>
          <div style="margin-top:4px;font-size:14px;color:#475569;">
            Document : ${documentNumber}
          </div>
        </div>
      `;
    })
    .join("");
}

function buildTravelersText(travelers: Traveler[]) {
  if (!travelers.length) {
    return "Aucun voyageur transmis.";
  }

  return travelers
    .map((traveler, index) => {
      const fullName = getTravelerFullName(traveler) || "-";
      const birthDate = formatApiDate(traveler.fechaNacimiento);
      const documentNumber = traveler.codigoDocumento || "-";

      return [
        `Voyageur ${index + 1}`,
        `Nom complet : ${fullName}`,
        `Date de naissance : ${birthDate}`,
        `Document : ${documentNumber}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildEmailHtml(input: BookingConfirmationEmailInput) {
  const isTestMode = input.mode === "test";

  return `
    <div style="background:#f8fafc;padding:32px 16px;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">
        <div style="background:#163B6D;padding:28px 24px;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;opacity:0.85;">
            Solair Voyages
          </div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.2;">
            ${isTestMode ? "Confirmation de test" : "Réservation confirmée"}
          </h1>
          <p style="margin:12px 0 0;font-size:14px;line-height:1.5;opacity:0.9;">
            ${
              isTestMode
                ? "Paiement sandbox capturé. Aucun dossier réel n’a été créé côté transporteur."
                : "Votre réservation a bien été créée côté Armas."
            }
          </p>
        </div>

        <div style="padding:24px;">
          <div style="display:block;">
            ${
              isTestMode
                ? `
            <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:16px;padding:16px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#9a3412;font-weight:700;">
                TEST
              </div>
              <div style="margin-top:8px;font-size:15px;line-height:1.6;color:#7c2d12;">
                Cet email confirme uniquement le bon fonctionnement du parcours de paiement en mode test. Aucune réservation réelle n’a été émise chez le transporteur.
              </div>
            </div>
            `
                : ""
            }

            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:16px;padding:16px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;font-weight:700;">
                ${isTestMode ? "Référence de test" : "Référence"}
              </div>
              <div style="margin-top:8px;font-size:28px;font-weight:700;color:#0f172a;">
                ${input.codigoLocata}
              </div>
            </div>

            <div style="margin-top:16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:16px;padding:16px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;font-weight:700;">
                Montant
              </div>
              <div style="margin-top:8px;font-size:24px;font-weight:700;color:#0f172a;">
                ${formatAmount(input.total)}
              </div>
            </div>

            <div style="margin-top:16px;background:#f8fafc;border-radius:16px;padding:16px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;font-weight:700;">
                Trajet
              </div>
              <div style="margin-top:8px;font-size:18px;font-weight:700;color:#0f172a;">
                ${input.origen} → ${input.destino}
              </div>
            </div>

            <div style="margin-top:16px;background:#f8fafc;border-radius:16px;padding:16px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;font-weight:700;">
                Départ
              </div>
              <div style="margin-top:8px;font-size:18px;font-weight:700;color:#0f172a;">
                ${formatApiDate(input.fechaSalida)} • ${formatApiTime(input.horaSalida)}
              </div>
            </div>

            ${
              input.inboundLeg
                ? `
            <div style="margin-top:16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:16px;padding:16px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;font-weight:700;">
                Retour — référence
              </div>
              <div style="margin-top:8px;font-size:22px;font-weight:700;color:#0f172a;">
                ${input.inboundLeg.codigoLocata}
              </div>
              <div style="margin-top:10px;font-size:16px;font-weight:700;color:#0f172a;">
                ${input.inboundLeg.origen} → ${input.inboundLeg.destino}
              </div>
              <div style="margin-top:6px;font-size:15px;color:#475569;">
                ${formatApiDate(input.inboundLeg.fechaSalida)} • ${formatApiTime(input.inboundLeg.horaSalida)}
              </div>
            </div>
            `
                : ""
            }

            <div style="margin-top:16px;background:#f8fafc;border-radius:16px;padding:16px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;font-weight:700;">
                Voyageurs
              </div>
              <div style="margin-top:12px;">
                ${buildTravelersHtml(input.travelers)}
              </div>
            </div>

            <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#475569;">
              ${
                isTestMode
                  ? "Conservez cet email comme preuve de test. Il ne correspond pas à une réservation réelle."
                  : "Conservez cet email. Il contient votre référence de réservation."
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildEmailText(input: BookingConfirmationEmailInput) {
  const isTestMode = input.mode === "test";

  return [
    "Solair Voyages",
    "",
    isTestMode ? "Confirmation de test" : "Réservation confirmée",
    ...(isTestMode
      ? [
          "",
          "TEST",
          "Paiement sandbox capturé. Aucune réservation réelle n’a été créée côté transporteur.",
        ]
      : []),
    "",
    `${isTestMode ? "Référence de test" : "Référence"} : ${input.codigoLocata}`,
    `Montant : ${formatAmount(input.total)}`,
    `Trajet : ${input.origen} → ${input.destino}`,
    `Départ : ${formatApiDate(input.fechaSalida)} • ${formatApiTime(
      input.horaSalida
    )}`,
    ...(input.inboundLeg
      ? [
          "",
          `Retour — référence : ${input.inboundLeg.codigoLocata}`,
          `Trajet retour : ${input.inboundLeg.origen} → ${input.inboundLeg.destino}`,
          `Départ retour : ${formatApiDate(input.inboundLeg.fechaSalida)} • ${formatApiTime(
            input.inboundLeg.horaSalida
          )}`,
        ]
      : []),
    "",
    "Voyageurs :",
    buildTravelersText(input.travelers),
    "",
    isTestMode
      ? "Conservez cet email comme preuve de test. Il ne correspond pas à une réservation réelle."
      : "Conservez cet email. Il contient votre référence de réservation.",
  ].join("\n");
}

export async function sendBookingConfirmationEmail(
  input: BookingConfirmationEmailInput
) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.EMAIL_FROM || "";
  const replyTo = process.env.EMAIL_REPLY_TO || "";

  if (!apiKey) {
    throw new Error("RESEND_API_KEY manquante.");
  }

  if (!from) {
    throw new Error("EMAIL_FROM manquant.");
  }

  const resend = new Resend(apiKey);

  const subject = `${
    input.mode === "test" ? "[TEST] " : ""
  }Réservation confirmée ${input.codigoLocata} – Solair Voyages`;

  const { data, error } = await resend.emails.send({
    from,
    to: [input.to],
    ...(replyTo ? { replyTo } : {}),
    subject,
    html: buildEmailHtml(input),
    text: buildEmailText(input),
  });

  if (error) {
    throw new Error(
      typeof error.message === "string"
        ? error.message
        : "Échec d’envoi de l’email de confirmation."
    );
  }

  return data;
}
