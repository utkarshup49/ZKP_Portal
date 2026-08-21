"use client";

/**
 * Shared presentation pieces. Each portal passes its accent so the three
 * screens stay visually distinct during a live demo.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type Accent = "university" | "student" | "employer" | "neutral";

interface AccentTokens {
  bar: string;
  text: string;
  softBg: string;
  softBorder: string;
  button: string;
  chipBg: string;
  ring: string;
}

/** Tailwind needs literal class names, so accents are an explicit lookup. */
export const ACCENTS: Record<Accent, AccentTokens> = {
  university: {
    bar: "bg-university-700",
    text: "text-university-700",
    softBg: "bg-university-50",
    softBorder: "border-university-200",
    button: "bg-university-700 text-white hover:bg-university-600",
    chipBg: "bg-university-100 text-university-900",
    ring: "focus:ring-university-400/50",
  },
  student: {
    bar: "bg-student-700",
    text: "text-student-700",
    softBg: "bg-student-50",
    softBorder: "border-student-200",
    button: "bg-student-700 text-white hover:bg-student-600",
    chipBg: "bg-student-100 text-student-900",
    ring: "focus:ring-student-400/50",
  },
  employer: {
    bar: "bg-employer-700",
    text: "text-employer-700",
    softBg: "bg-employer-50",
    softBorder: "border-employer-200",
    button: "bg-employer-700 text-white hover:bg-employer-600",
    chipBg: "bg-employer-100 text-employer-900",
    ring: "focus:ring-employer-400/50",
  },
  neutral: {
    bar: "bg-slate-800",
    text: "text-slate-800",
    softBg: "bg-slate-50",
    softBorder: "border-slate-200",
    button: "bg-slate-800 text-white hover:bg-slate-700",
    chipBg: "bg-slate-200 text-slate-900",
    ring: "focus:ring-slate-400/50",
  },
};

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function PortalHeader({
  accent,
  eyebrow,
  title,
  description,
}: {
  accent: Accent;
  eyebrow: string;
  title: string;
  description: string;
}) {
  const tokens = ACCENTS[accent];
  return (
    <header className="mb-8">
      <div className={`mb-4 h-1.5 w-24 rounded-full ${tokens.bar}`} />
      <p
        className={`text-sm font-bold uppercase tracking-[0.18em] ${tokens.text}`}
      >
        {eyebrow}
      </p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-ink">{title}</h1>
      <p className="mt-3 max-w-3xl text-lg leading-relaxed text-ink-soft">
        {description}
      </p>
    </header>
  );
}

export function Section({
  accent,
  step,
  title,
  description,
  children,
  aside,
}: {
  accent: Accent;
  step: string;
  title: string;
  description?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  const tokens = ACCENTS[accent];
  return (
    <section className="card mb-6">
      <div className="card-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-sm font-bold ${tokens.chipBg}`}
            >
              {step}
            </span>
            <h2 className="text-xl font-bold text-ink">{title}</h2>
          </div>
          {description ? (
            <p className="mt-2 max-w-3xl text-base text-ink-soft">{description}</p>
          ) : null}
        </div>
        {aside}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function Button({
  accent = "neutral",
  variant = "solid",
  loading = false,
  children,
  className = "",
  ...props
}: {
  accent?: Accent;
  variant?: "solid" | "outline";
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const tokens = ACCENTS[accent];
  const base =
    variant === "solid"
      ? `btn ${tokens.button}`
      : `btn border-2 ${tokens.softBorder} ${tokens.softBg} ${tokens.text} hover:brightness-95`;

  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`${base} ${className}`}
    >
      {loading ? (
        <span
          aria-hidden
          className="spinner h-4 w-4 rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Hashes                                                              */
/* ------------------------------------------------------------------ */

export function truncateHash(value: string, lead = 6, tail = 4): string {
  if (typeof value !== "string") return String(value);
  if (value.length <= lead + tail + 3) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/** Monospace hash with click-to-copy. */
export function Hash({
  value,
  full = false,
  lead = 6,
  tail = 4,
  className = "",
  title,
}: {
  value: string;
  full?: boolean;
  lead?: number;
  tail?: number;
  className?: string;
  title?: string;
}) {
  const { copied, copy } = useCopy();
  const shown = full ? value : truncateHash(value, lead, tail);

  return (
    <button
      type="button"
      onClick={() => copy(value)}
      title={title ?? `${value}\n(click to copy)`}
      className={`mono inline-flex items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-2 py-1
        text-ink transition hover:border-slate-400 hover:bg-slate-100 ${className}`}
    >
      <span className={full ? "break-all text-left" : ""}>{shown}</span>
      <span
        className={`text-xs font-semibold ${copied ? "text-student-600" : "text-ink-faint"}`}
      >
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}

/** Large monospace display for a root or other headline value. */
export function HashDisplay({
  label,
  value,
  accent = "neutral",
}: {
  label: string;
  value: string;
  accent?: Accent;
}) {
  const tokens = ACCENTS[accent];
  const { copied, copy } = useCopy();

  return (
    <div className={`rounded-lg border-2 ${tokens.softBorder} ${tokens.softBg} p-4`}>
      <div className="flex items-center justify-between gap-4">
        <span className={`text-sm font-bold uppercase tracking-wide ${tokens.text}`}>
          {label}
        </span>
        <button
          type="button"
          onClick={() => copy(value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-slate-50"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mono mt-2 break-all text-lg font-semibold leading-snug text-ink">
        {value}
      </p>
    </div>
  );
}

export function useCopy(resetAfterMs = 1400) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        // Clipboard can be blocked on insecure origins; fall back to a
        // selectable prompt rather than failing silently.
        window.prompt("Copy to clipboard:", value);
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetAfterMs);
    },
    [resetAfterMs],
  );

  return { copied, copy };
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function Callout({
  tone,
  title,
  children,
}: {
  tone: "info" | "success" | "warning" | "danger";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: "border-slate-300 bg-slate-50 text-ink",
    success: "border-student-400 bg-student-50 text-student-900",
    warning: "border-employer-400 bg-employer-50 text-employer-900",
    danger: "border-red-400 bg-red-50 text-red-900",
  } as const;

  return (
    <div className={`rounded-lg border-2 p-4 ${tones[tone]}`}>
      {title ? <p className="mb-1 text-base font-bold">{title}</p> : null}
      <div className="text-base leading-relaxed">{children}</div>
    </div>
  );
}

/**
 * The honesty banner. Shown on the student and employer portals, where a
 * viewer might otherwise assume a real SNARK is running.
 */
export function DemoModeBanner() {
  return (
    <div className="mb-6 rounded-lg border-2 border-employer-400 bg-employer-50 px-5 py-4">
      <p className="text-base font-semibold leading-relaxed text-employer-900">
        <span className="mr-2 rounded bg-employer-400 px-2 py-0.5 text-sm font-bold uppercase tracking-wide text-white">
          Demo mode
        </span>
        Proof object is simulated. All commitments, Merkle paths and constraint
        checks are real.
      </p>
    </div>
  );
}

export function JsonBlock({
  value,
  maxHeight = "24rem",
}: {
  value: unknown;
  maxHeight?: string;
}) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      className="mono overflow-auto rounded-lg border border-slate-300 bg-slate-900 p-4 text-sm leading-relaxed text-slate-100"
      style={{ maxHeight }}
    >
      {text}
    </pre>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-base text-ink-faint">
      {children}
    </p>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label mb-1.5">{label}</label>
      {children}
      {hint ? <p className="mt-1.5 text-sm text-ink-faint">{hint}</p> : null}
    </div>
  );
}
