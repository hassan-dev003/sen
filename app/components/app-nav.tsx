"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The app's top bar. Only the surfaces that exist are linked — Review and Import
 * today; Ledger, Budgets, and Settings arrive in later sprints (docs/roadmap.md).
 */
const LINKS = [
  { href: "/review", label: "Review" },
  { href: "/import", label: "Import" },
] as const;

export function AppNav({ email }: { email?: string | null }) {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-6 px-5">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Sen
        </Link>
        <ul className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "rounded-md px-3 py-1.5 text-sm transition-colors " +
                    (active
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-muted hover:text-ink")
                  }
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="ml-auto flex items-center gap-3">
          {email ? (
            <span className="hidden text-xs text-faint sm:inline">{email}</span>
          ) : null}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
