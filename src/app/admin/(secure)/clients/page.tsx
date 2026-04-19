import { listAdminSales } from "@/lib/admin-sales";

export const dynamic = "force-dynamic";

type ClientSummary = {
  key: string;
  name: string;
  email: string;
  phone: string;
  bookings: number;
  revenue: number;
};

function formatMoney(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";

  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export default async function AdminClientsPage() {
  const { sales } = await listAdminSales();
  const clients = new Map<string, ClientSummary>();

  for (const sale of sales) {
    const key = sale.customerEmail || sale.customerPhone || sale.customerName || sale.id;
    const existing = clients.get(key) || {
      key,
      name: sale.customerName,
      email: sale.customerEmail,
      phone: sale.customerPhone,
      bookings: 0,
      revenue: 0,
    };

    existing.bookings += 1;
    existing.revenue += sale.totalAmount || 0;
    clients.set(key, existing);
  }

  const rows = Array.from(clients.values()).sort((a, b) => b.bookings - a.bookings);

  return (
    <main className="mx-auto flex w-full max-w-[1700px] flex-col gap-6 px-4 py-8 sm:px-6 xl:px-10">
      <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-6 xl:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#a38c78]">
          Administration
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#3a2d26]">
          Clients
        </h2>
        <p className="mt-2 text-sm text-[#8d7764]">
          Vue synthétique des clients enregistrés dans les dossiers.
        </p>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-[#eadfd3] bg-white shadow-[0_18px_38px_rgb(80_61_43/0.08)]">
        <div className="hidden grid-cols-[1.6fr_1.6fr_1.2fr_140px_160px] gap-4 border-b border-[#eee1d4] bg-[#f6f1ea] px-5 py-5 text-sm font-semibold text-[#8a7564] xl:grid">
          <span>Client</span>
          <span>Email</span>
          <span>Téléphone</span>
          <span>Dossiers</span>
          <span>Montant cumulé</span>
        </div>
        <div className="divide-y divide-[#f0e5db]">
          {rows.map((client) => (
            <div
              key={client.key}
              className="grid gap-3 px-5 py-5 xl:grid-cols-[1.6fr_1.6fr_1.2fr_140px_160px] xl:items-center xl:gap-4"
            >
              <div className="font-semibold text-[#2f2826]">{client.name || "-"}</div>
              <div className="text-[#8d7764]">{client.email || "-"}</div>
              <div className="text-[#8d7764]">{client.phone || "-"}</div>
              <div className="font-semibold text-[#2f2826]">{client.bookings}</div>
              <div className="font-semibold text-[#9b7225]">
                {formatMoney(client.revenue)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
