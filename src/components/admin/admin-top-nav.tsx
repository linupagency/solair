"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin/vue-generale", label: "Vue générale" },
  { href: "/admin", label: "Réservations" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/trajets", label: "Trajets" },
  { href: "/admin/stats", label: "Stats" },
  { href: "/admin/suivi", label: "Suivi" },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") {
    return pathname === "/admin" || pathname.startsWith("/admin/ventes/");
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminTopNav() {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-3 text-[0.98rem] font-semibold text-white/70 xl:flex">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-2xl px-4 py-2 transition ${
              active
                ? "bg-[#b63524] text-white shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]"
                : "hover:bg-white/6 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
