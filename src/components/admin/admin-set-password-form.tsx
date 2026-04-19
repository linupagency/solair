"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AdminSetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      if (password !== confirmPassword) {
        throw new Error("Les mots de passe ne correspondent pas.");
      }

      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        throw new Error(updateError.message);
      }

      router.replace("/admin");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Erreur inconnue."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-semibold text-[#6f5e50]" htmlFor="new-password">
          Nouveau mot de passe
        </label>
        <input
          id="new-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-2xl border border-[#e9ddd0] bg-white px-4 py-3 text-[1rem] text-[#2f2826] outline-none transition focus:border-[#c9b29d]"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-[#6f5e50]" htmlFor="confirm-new-password">
          Confirmer le mot de passe
        </label>
        <input
          id="confirm-new-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="w-full rounded-2xl border border-[#e9ddd0] bg-white px-4 py-3 text-[1rem] text-[#2f2826] outline-none transition focus:border-[#c9b29d]"
        />
      </div>

      {error ? (
        <div className="rounded-2xl border border-[#f3d5cc] bg-[#fff1ed] px-4 py-3 text-sm text-[#9d4b38]">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-[#b63524] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#9f2f20] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Mise à jour..." : "Définir le mot de passe"}
      </button>
    </form>
  );
}
