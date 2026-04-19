import { AdminInviteForm } from "@/components/admin/admin-invite-form";
import { getAdminAllowedEmails } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default function AdminUsersPage() {
  const allowedEmails = getAdminAllowedEmails();

  return (
    <main className="mx-auto flex w-full max-w-[1700px] flex-col gap-6 px-4 py-8 sm:px-6 xl:px-10">
      <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-6 xl:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#a38c78]">
          Sécurité admin
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#3a2d26]">
          Utilisateurs administrateurs
        </h2>
        <p className="mt-2 text-sm text-[#8d7764]">
          L&apos;inscription libre est désactivée. Seul un administrateur déjà
          connecté peut inviter un nouvel utilisateur.
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-6 xl:px-8">
          <h3 className="text-[1.15rem] font-semibold text-[#3a2d26]">
            Envoyer une invitation
          </h3>
          <p className="mt-2 text-sm text-[#8d7764]">
            L&apos;utilisateur invité recevra un email Supabase puis définira son
            mot de passe sur ce site.
          </p>

          <div className="mt-6">
            <AdminInviteForm />
          </div>
        </section>

        <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-6">
          <h3 className="text-[1.15rem] font-semibold text-[#3a2d26]">
            Règles d&apos;accès
          </h3>
          <div className="mt-4 space-y-3 text-sm text-[#8d7764]">
            <p>Inscription publique: désactivée</p>
            <p>Connexion: réservée aux utilisateurs déjà invités</p>
            <p>Création de compte: invitation par un admin connecté</p>
          </div>

          <div className="mt-6 rounded-[22px] border border-[#eadfd3] bg-[#fcfaf7] px-4 py-4">
            <p className="text-sm font-semibold text-[#6f5e50]">
              Emails autorisés
            </p>
            {allowedEmails.length > 0 ? (
              <div className="mt-3 space-y-2 text-sm text-[#8d7764]">
                {allowedEmails.map((email) => (
                  <p key={email}>{email}</p>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[#8d7764]">
                Aucune whitelist active pour le moment. Ajoute
                `ADMIN_ALLOWED_EMAILS` dans `.env.local` pour restreindre les
                invitations.
              </p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
