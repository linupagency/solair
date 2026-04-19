const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || "";

export function isSupabasePublicConfigured() {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

export function getSupabasePublicConfig() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY manquante."
    );
  }

  return {
    supabaseUrl,
    supabasePublishableKey,
  };
}

export function getAdminAllowedEmails() {
  return String(process.env.ADMIN_ALLOWED_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email?: string | null) {
  if (!email) return false;

  const allowedEmails = getAdminAllowedEmails();
  if (allowedEmails.length === 0) return true;

  return allowedEmails.includes(email.trim().toLowerCase());
}
