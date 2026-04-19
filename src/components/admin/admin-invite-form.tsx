"use client";

import { useState } from "react";

type InviteResponse = {
  ok: boolean;
  message?: string;
};

export function AdminInviteForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/auth/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const json = (await response.json()) as InviteResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.message || "Impossible d'envoyer l'invitation.");
      }

      setSuccess(
        json.message ||
          "Invitation envoyée. Le nouvel administrateur recevra un email."
      );
      setEmail("");
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
        <label className="text-sm font-semibold text-[#6f5e50]" htmlFor="invite-email">
          Email de l&apos;administrateur à inviter
        </label>
        <input
          id="invite-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="admin@solair-voyages.com"
          className="w-full rounded-2xl border border-[#e9ddd0] bg-white px-4 py-3 text-[1rem] text-[#2f2826] outline-none transition focus:border-[#c9b29d]"
        />
      </div>

      {error ? (
        <div className="rounded-2xl border border-[#f3d5cc] bg-[#fff1ed] px-4 py-3 text-sm text-[#9d4b38]">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-2xl border border-[#d9ead2] bg-[#eef6eb] px-4 py-3 text-sm text-[#3f7f4a]">
          {success}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-2xl bg-[#b63524] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#9f2f20] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Envoi..." : "Envoyer l'invitation"}
      </button>
    </form>
  );
}
