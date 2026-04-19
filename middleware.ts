import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  getSupabasePublicConfig,
  isAdminEmail,
  isSupabasePublicConfigured,
} from "@/lib/supabase/config";

const AUTH_ROUTES = new Set([
  "/admin/login",
  "/admin/register",
  "/admin/auth/callback",
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  if (!isSupabasePublicConfigured()) {
    return NextResponse.next();
  }

  const { supabaseUrl, supabasePublishableKey } = getSupabasePublicConfig();

  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = AUTH_ROUTES.has(pathname);
  const isAllowedUser = isAdminEmail(user?.email);

  if (isAuthRoute) {
    if (user && isAllowedUser) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }

    return response;
  }

  if (!user) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!isAllowedUser) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("error", "not_allowed");
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
