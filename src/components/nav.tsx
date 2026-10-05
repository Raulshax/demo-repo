"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export interface NavItem { href: string; label: string; count?: number }

export function NavLinks({ items, horizontal }: { items: NavItem[]; horizontal?: boolean }) {
  const pathname = usePathname();
  return (
    <ul className={horizontal ? "flex gap-1 overflow-x-auto px-3 pb-2" : "space-y-0.5"}>
      {items.map((it) => {
        const active = pathname === it.href || (it.href !== "/dashboard" && pathname.startsWith(it.href + "/")) || pathname === it.href;
        return (
          <li key={it.href} className="shrink-0">
            <Link href={it.href} className={cx(
              "flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm",
              active ? "bg-nav-active font-medium text-white" : "text-nav-text hover:bg-nav-active hover:text-white")}>
              <span>{it.label}</span>
              {!!it.count && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">{it.count}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
