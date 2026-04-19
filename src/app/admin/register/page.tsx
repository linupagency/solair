import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AdminRegisterPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && isAdminEmail(user.email)) {
    redirect("/admin");
  }

  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-6 px-4 py-10 sm:px-6 xl:px-0">
      <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#a38c78]">
          Sécurité admin
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#3a2d26]">
          Inscription libre désactivée
        </h2>
        <p className="mt-2 text-sm text-[#8d7764]">
          L&apos;accès à la console admin se fait désormais uniquement sur
          invitation envoyée par un administrateur déjà connecté.
        </p>

        <div className="mt-8 rounded-[22px] border border-[#eadfd3] bg-[#fcfaf7] px-5 py-5 text-sm text-[#8d7764]">
          <p>
            Si vous avez déjà un compte, connectez-vous sur la page de connexion.
          </p>
          <p className="mt-3">
            Si vous devez accéder à l&apos;administration, demandez à un
            administrateur de vous inviter depuis la console sécurisée.
          </p>
          <a
            href="/admin/login"
            className="mt-5 inline-flex rounded-2xl bg-[#b63524] px-5 py-3 font-semibold text-white transition hover:bg-[#9f2f20]"
          >
            Aller à la connexion
          </a>
        </div>
      </section>
    </main>
  );
}
