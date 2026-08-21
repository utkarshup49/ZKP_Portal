"use client";

/**
 * Shared top navigation. One click between portals — during a live demo you
 * move university → employer → student → employer several times.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview", dot: "bg-slate-500" },
  { href: "/university", label: "University", dot: "bg-university-600" },
  { href: "/student", label: "Student", dot: "bg-student-600" },
  { href: "/employer", label: "Employer", dot: "bg-employer-600" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-300 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-8 px-6 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-sm font-bold text-white">
            ZK
          </span>
          <span className="text-lg font-bold tracking-tight text-ink">
            Credential Verification
          </span>
        </Link>

        <ul className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-base font-semibold transition ${
                    active
                      ? "bg-slate-900 text-white"
                      : "text-ink-soft hover:bg-slate-100 hover:text-ink"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${link.dot}`} />
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <span className="ml-auto rounded-md border border-employer-300 bg-employer-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-employer-700">
          Demo mode
        </span>
      </div>
    </nav>
  );
}
