"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type AdminAuthFormProps = {
  mode: "login";
};

export function AdminAuthForm({ mode }: AdminAuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const nextPath = useMemo(() => {
    const raw = searchParams.get("next");
    if (!raw || !raw.startsWith("/")) return "/admin";
    return raw;
  }, [searchParams]);

  async function handleLogin() {
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      throw new Error(signInError.message);
    }

    router.replace(nextPath);
    router.refresh();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      await handleLogin();
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
        <label className="text-sm font-semibold text-[#6f5e50]" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-2xl border border-[#e9ddd0] bg-white px-4 py-3 text-[1rem] text-[#2f2826] outline-none transition focus:border-[#c9b29d]"
          placeholder="nom@solair-voyages.com"
        />
      </div>

      <div className="space-y-2">
        <label
          className="text-sm font-semibold text-[#6f5e50]"
          htmlFor="password"
        >
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-2xl border border-[#e9ddd0] bg-white px-4 py-3 text-[1rem] text-[#2f2826] outline-none transition focus:border-[#c9b29d]"
          placeholder="Au moins 8 caractères"
        />
      </div>

      {error ? (
        <div className="rounded-2xl border border-[#f3d5cc] bg-[#fff1ed] px-4 py-3 text-sm text-[#9d4b38]">
          {error}
        </div>
      ) : null}

      {mode === "login" && searchParams.get("error") === "not_allowed" ? (
        <div className="rounded-2xl border border-[#f3d5cc] bg-[#fff1ed] px-4 py-3 text-sm text-[#9d4b38]">
          Ce compte existe peut-être, mais il n&apos;est pas autorisé pour
          l&apos;espace admin.
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-[#b63524] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#9f2f20] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Connexion..." : "Se connecter"}
      </button>

      <div className="text-sm text-[#8d7764]">
        <p>
          La création de compte libre est désactivée. Un administrateur doit vous
          inviter pour accéder à la console.
        </p>
        <p className="mt-2">
          Besoin d&apos;aide ?{" "}
          <Link href="/admin/register" className="font-semibold text-[#b63524]">
            En savoir plus
          </Link>
        </p>
      </div>
    </form>
  );
}
