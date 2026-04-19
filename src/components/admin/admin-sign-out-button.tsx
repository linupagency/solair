"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AdminSignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);

    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();

    router.replace("/admin/login");
    router.refresh();
    setPending(false);
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className="rounded-2xl border border-white/14 px-4 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Déconnexion..." : "Déconnexion"}
    </button>
  );
}
