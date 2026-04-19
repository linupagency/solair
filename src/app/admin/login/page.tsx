import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/supabase/config";
import { AdminAuthForm } from "@/components/admin/admin-auth-form";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
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
          Connexion à la console
        </h2>
        <p className="mt-2 text-sm text-[#8d7764]">
          Connectez-vous avec un compte utilisateur autorisé pour accéder aux
          pages d&apos;administration.
        </p>

        <div className="mt-8">
          <AdminAuthForm mode="login" />
        </div>
      </section>
    </main>
  );
}
