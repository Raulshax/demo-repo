"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export interface NavItem { href: string; label: string; count?: number }

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && href !== "/admin" && pathname.startsWith(href + "/"));
}

/** Portal tabs (A): mono caps, 2px ink underline on the active tab. */
export function NavTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex min-w-0 overflow-x-auto [scrollbar-width:none]">
      {items.map((it) => {
        const on = isActive(pathname, it.href);
        return (
          <li key={it.href} className="shrink-0">
            <Link href={it.href} className={cx(
              "m flex items-center gap-1.5 border-b-2 px-3.5 pt-[21px] pb-[19px]",
              on ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}>
              {it.label}
              {!!it.count && <span className="bg-ink px-1.5 py-px text-[10px] text-surface">{it.count}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Desk sidebar (B, graphite). */
export function NavSide({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-wrap gap-0.5 lg:flex-col">
      {items.map((it) => {
        const on = isActive(pathname, it.href);
        return (
          <li key={it.href}>
            <Link href={it.href} className={cx(
              "m flex items-center justify-between gap-2 px-2.5 py-[9px]",
              on ? "bg-surface text-ink" : "text-muted hover:bg-surface hover:text-ink")}>
              <span>{it.label}</span>
              {!!it.count && <span className="bg-ink px-1.5 text-[10px] text-bg">{it.count}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
