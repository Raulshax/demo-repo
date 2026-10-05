import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { titleCase } from "@/lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- layout
export function PageHeader({ title, subtitle, actions, crumbs }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { href: string; label: string }[];
}) {
  return (
    <div className="mb-6">
      {crumbs && (
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted">
          {crumbs.map((c, i) => (
            <span key={c.href} className="flex items-center gap-1">
              {i > 0 && <span className="text-subtle">/</span>}
              <Link href={c.href} className="hover:text-ink">{c.label}</Link>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true, subtitle }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; subtitle?: ReactNode;
}) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "bad" | "neutral" }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular text-ink">{value}</div>
      {hint && (
        <div className={cx("mt-0.5 text-xs", tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : "text-muted")}>{hint}</div>
      )}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      <div className="text-sm font-medium text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- buttons
type Variant = "primary" | "secondary" | "ghost" | "danger" | "ai";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover border-transparent",
  secondary: "bg-surface text-ink border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-muted border-transparent hover:bg-surface-2 hover:text-ink",
  danger: "bg-danger text-white border-transparent hover:opacity-90",
  ai: "bg-ai text-white border-transparent hover:opacity-90",
};
const btnBase = "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";

export function Button({ variant = "primary", className, size, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: "sm" }) {
  return <button {...props} className={cx(btnBase, variants[variant], size === "sm" && "px-2 py-1 text-xs", className)} />;
}

export function ButtonLink({ variant = "primary", className, size, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" }) {
  return <Link {...props} className={cx(btnBase, variants[variant], size === "sm" && "px-2 py-1 text-xs", className)} />;
}

// ---------------------------------------------------------------- badges
type Tone = "neutral" | "accent" | "success" | "warn" | "danger" | "info" | "ai";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
  ai: "bg-ai-soft text-ai border-transparent",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  draft: "neutral", confirmed: "accent", in_rfq: "info", ordered: "success", cancelled: "neutral",
  sent: "info", closed: "neutral", awarded: "success",
  recommended: "ai", invited: "info", viewed: "info", quoted: "accent", declined: "neutral", not_selected: "neutral",
  submitted: "info", withdrawn: "neutral", accepted: "success", rejected: "danger",
  pending: "warn", approved: "success",
  issued: "warn", in_delivery: "info", partially_delivered: "warn", delivered: "success",
  scheduled: "neutral", dispatched: "info", partially_accepted: "warn",
  matched: "success", mismatch: "danger", paid: "success", disputed: "danger",
  open: "danger", supplier_responded: "warn", escalated: "danger", resolved: "success",
  active: "success", planning: "neutral", on_hold: "warn", completed: "neutral", suspended: "danger",
  uploaded: "neutral", processing: "info", extracted: "success", failed: "danger",
};
const STATUS_LABEL: Record<string, string> = { in_rfq: "In RFQ", issued: "Awaiting confirmation", supplier_responded: "Supplier responded" };

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{STATUS_LABEL[status] ?? titleCase(status)}</Badge>;
}

export function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <Badge>Manual</Badge>;
  const tone: Tone = value >= 0.85 ? "success" : value >= 0.6 ? "warn" : "danger";
  return <Badge tone={tone}>{Math.round(value * 100)}% match</Badge>;
}

// ---------------------------------------------------------------- tables
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, right }: { children?: ReactNode; className?: string; right?: boolean }) {
  return <th className={cx("border-b border-line bg-surface-2 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted whitespace-nowrap", right && "text-right", className)}>{children}</th>;
}
export function Td({ children, className, right, colSpan }: { children?: ReactNode; className?: string; right?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("border-b border-line px-3 py-2 align-top text-ink", right && "text-right tabular", className)}>{children}</td>;
}

// ---------------------------------------------------------------- forms
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-ink placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}
export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea rows={3} {...props} className={cx(inputCls, props.className)} />;
}

// ---------------------------------------------------------------- misc
export function Progress({ value, tone = "accent" }: { value: number; tone?: "accent" | "warn" | "success" }) {
  const color = tone === "warn" ? "bg-warn" : tone === "success" ? "bg-success" : "bg-accent";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={cx("h-full rounded-full", color)} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function AiPanel({ title, children, footer }: { title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="rounded-lg border border-ai/30 bg-ai-soft/60 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ai">
        <SparkIcon /> AI recommendation
      </div>
      <div className="mt-1.5 text-base font-semibold text-ink">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-ink">{children}</div>
      {footer && <div className="mt-3 text-xs text-muted">{footer}</div>}
    </section>
  );
}

export function SparkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm6.5 11l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" />
    </svg>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-line py-1.5 text-sm sm:block sm:border-0 sm:py-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="text-right text-ink sm:mt-0.5 sm:text-left">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
