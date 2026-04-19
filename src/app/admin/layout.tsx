import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/supabase/config";
import { AdminTopNav } from "@/components/admin/admin-top-nav";
import { AdminSignOutButton } from "@/components/admin/admin-sign-out-button";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let userEmail = "";
  let authenticatedAdmin = false;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    userEmail = user?.email || "";
    authenticatedAdmin = isAdminEmail(user?.email);
  } catch {
    authenticatedAdmin = false;
  }

  return (
    <div className="min-h-full bg-[#f6f1ea] text-[#2f2826]">
      <header className="border-b border-black/10 bg-[#474241] text-white">
        <div className="mx-auto flex w-full max-w-[1700px] items-center justify-between gap-6 px-6 py-5 xl:px-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#cc4a35]/18 text-[#ff715c]">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 11V6a3 3 0 0 0-6 0v5" />
                <path d="M5 10h14l-1 9H6l-1-9Z" />
                <path d="M9 14v.01" />
                <path d="M15 14v.01" />
              </svg>
            </div>
            <div>
              <p className="text-[0.95rem] font-semibold text-white/75">
                Solair Voyages
              </p>
              <h1 className="text-[1.15rem] font-semibold tracking-tight">
                Solair Admin
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {authenticatedAdmin ? (
              <>
                <AdminTopNav />
                <div className="hidden items-center gap-3 xl:flex">
                  <Link
                    href="/admin/utilisateurs"
                    className="rounded-2xl border border-white/14 px-4 py-2 text-sm font-semibold text-white/84 transition hover:bg-white/8"
                  >
                    Utilisateurs
                  </Link>
                  <span className="text-sm font-medium text-white/72">
                    {userEmail}
                  </span>
                  <AdminSignOutButton />
                </div>
              </>
            ) : (
              <div className="hidden items-center gap-3 xl:flex">
                <Link
                  href="/admin/login"
                  className="rounded-2xl px-4 py-2 text-[0.98rem] font-semibold text-white/84 transition hover:bg-white/8"
                >
                  Connexion
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
