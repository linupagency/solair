import { AdminSetPasswordForm } from "@/components/admin/admin-set-password-form";

export const dynamic = "force-dynamic";

export default function AdminSetPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 py-8 sm:px-6 xl:px-0">
      <section className="rounded-[28px] border border-[#eadfd3] bg-white px-5 py-6 shadow-[0_16px_32px_rgb(80_61_43/0.06)] sm:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#a38c78]">
          Sécurité admin
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#3a2d26]">
          Définir le mot de passe
        </h2>
        <p className="mt-2 text-sm text-[#8d7764]">
          Finalisez l&apos;invitation en choisissant le mot de passe du compte.
        </p>

        <div className="mt-8">
          <AdminSetPasswordForm />
        </div>
      </section>
    </main>
  );
}
