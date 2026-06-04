import * as React from "react";

/* ---------------------------------------------------------------------------
   husn.io presentational UI kit. No client state here, no UI libraries.
   Everything reads CSS-variable tokens so light/dark + theme stay consistent.
--------------------------------------------------------------------------- */

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "dark";

const TILE_BG: Record<Tone, React.CSSProperties> = {
  neutral: { background: "var(--panel)", color: "var(--text)", borderColor: "var(--border)" },
  accent: { background: "var(--accent-soft)", color: "var(--text)", borderColor: "var(--accent-line)" },
  success: { background: "var(--success-soft)", color: "var(--text)", borderColor: "var(--success-line)" },
  warning: { background: "var(--warning-soft)", color: "var(--text)", borderColor: "var(--warning-line)" },
  danger: { background: "var(--danger-soft)", color: "var(--text)", borderColor: "var(--danger-line)" },
  dark: { background: "var(--dark-panel)", color: "var(--dark-text)", borderColor: "var(--dark-border)" },
};

const TONE_INK: Record<Tone, string> = {
  neutral: "var(--muted)",
  accent: "var(--accent-ink)",
  success: "var(--success-ink)",
  warning: "var(--warning-ink)",
  danger: "var(--danger-ink)",
  dark: "var(--dark-muted)",
};

/** Surface primitive: hairline border + soft shadow, optional hover lift. */
export function Tile({
  tone = "neutral",
  lift = false,
  className = "",
  style,
  children,
  ...rest
}: {
  tone?: Tone;
  lift?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[var(--radius)] border p-6 ${lift ? "husn-lift" : ""} ${className}`}
      style={{
        boxShadow: "var(--shadow-sm)",
        ...TILE_BG[tone],
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Big-numeral stat. Glanceable: numeral dominates, caption is quiet. */
export function Stat({
  value,
  caption,
  tone = "neutral",
  hint,
}: {
  value: React.ReactNode;
  caption: string;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div>
      <div
        className="font-semibold leading-none"
        style={{ fontSize: 40, letterSpacing: "-0.03em" }}
      >
        {value}
      </div>
      <p className="mt-2 text-[13px] font-medium">{caption}</p>
      {hint ? (
        <p className="mt-1 text-[12px]" style={{ color: TONE_INK[tone] }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Pill / badge. Used for status + categories. */
export function Pill({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  const map: Record<Tone, React.CSSProperties> = {
    neutral: { background: "var(--panel-2)", color: "var(--muted)", borderColor: "var(--border)" },
    accent: { background: "var(--accent-soft)", color: "var(--accent-ink)", borderColor: "var(--accent-line)" },
    success: { background: "var(--success-soft)", color: "var(--success-ink)", borderColor: "var(--success-line)" },
    warning: { background: "var(--warning-soft)", color: "var(--warning-ink)", borderColor: "var(--warning-line)" },
    danger: { background: "var(--danger-soft)", color: "var(--danger-ink)", borderColor: "var(--danger-line)" },
    dark: { background: "var(--dark-panel-2)", color: "var(--dark-text)", borderColor: "var(--dark-border)" },
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${className}`}
      style={map[tone]}
    >
      {children}
    </span>
  );
}

/** Small status dot. */
export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  const c: Record<Tone, string> = {
    neutral: "var(--muted)",
    accent: "var(--accent)",
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
    dark: "var(--dark-muted)",
  };
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: c[tone] }}
    />
  );
}

/** Monospace source citation chip, e.g. "Jira · ATLAS-204". First-class. */
export function EvidenceChip({
  source,
  cite: refLabel,
  tone = "neutral",
  title,
}: {
  source: string;
  cite?: string;
  tone?: Tone;
  title?: string;
}) {
  const map: Record<Tone, React.CSSProperties> = {
    neutral: { background: "var(--panel-2)", color: "var(--muted)", borderColor: "var(--border)" },
    accent: { background: "var(--accent-soft)", color: "var(--accent-ink)", borderColor: "var(--accent-line)" },
    success: { background: "var(--success-soft)", color: "var(--success-ink)", borderColor: "var(--success-line)" },
    warning: { background: "var(--warning-soft)", color: "var(--warning-ink)", borderColor: "var(--warning-line)" },
    danger: { background: "var(--danger-soft)", color: "var(--danger-ink)", borderColor: "var(--danger-line)" },
    dark: { background: "var(--dark-panel-2)", color: "var(--dark-text)", borderColor: "var(--dark-border)" },
  };
  return (
    <span
      title={title ?? `${source}${refLabel ? ` · ${refLabel}` : ""}`}
      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]"
      style={map[tone]}
    >
      <span style={{ opacity: 0.8 }}>{source}</span>
      {refLabel ? (
        <>
          <span aria-hidden style={{ opacity: 0.45 }}>·</span>
          <span className="font-medium">{refLabel}</span>
        </>
      ) : null}
    </span>
  );
}

/** One source's claim inside a conflict. Shown EQUALLY beside its peer. */
export type ConflictSide = {
  source: string;
  cite?: string;
  value: string;
  detail?: string;
};

/** Two disagreeing sources, side-by-side, equal weight, never collapsed. */
export function ConflictPair({ a, b }: { a: ConflictSide; b: ConflictSide }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[a, b].map((s, i) => (
        <div
          key={i}
          className="rounded-[var(--radius-sm)] border p-3.5"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <EvidenceChip source={s.source} cite={s.cite} />
          <p className="mt-2 text-[19px] font-semibold" style={{ letterSpacing: "-0.02em" }}>
            {s.value}
          </p>
          {s.detail ? (
            <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
              {s.detail}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Collapsible persona brief: headline + bulleted body. */
export function PersonaBrief({
  persona,
  headline,
  meta,
  defaultOpen = false,
  children,
}: {
  persona: string;
  headline: string;
  meta?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-[var(--radius-sm)] border"
      style={{ background: "var(--panel-2)", borderColor: "var(--border)" }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3">
        <span className="flex min-w-0 items-center gap-2">
          <Pill tone="accent">{persona}</Pill>
          <span className="truncate text-[13px] font-medium">{headline}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {meta ? (
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              {meta}
            </span>
          ) : null}
          <span
            aria-hidden
            className="text-[11px] transition-transform duration-200 group-open:rotate-90"
            style={{ color: "var(--muted)" }}
          >
            ▸
          </span>
        </span>
      </summary>
      <div className="border-t px-3.5 py-3" style={{ borderColor: "var(--border)" }}>
        {children}
      </div>
    </details>
  );
}

/** Section heading used inside cards. */
export function CardHeader({
  title,
  subtitle,
  right,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--muted)" }}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/* ---- State primitives: every list/card has these three ------------------ */

export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-[var(--radius-sm)] border border-dashed p-6 text-center"
      style={{ borderColor: "var(--border-strong)", background: "var(--panel-2)" }}
    >
      <p className="text-[14px] font-medium">{title}</p>
      {hint ? (
        <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
          {hint}
        </p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-[var(--radius-sm)] border p-5"
      style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
      role="status"
      aria-live="polite"
    >
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--muted)", opacity: 0.4 + i * 0.2 }}
          />
        ))}
      </span>
      <span className="text-[13px]" style={{ color: "var(--muted)" }}>
        {label}
      </span>
    </div>
  );
}

export function OfflineState({
  title = "We could not reach your data",
  hint = "This usually clears on its own. Check your connection or try again in a moment.",
}: {
  title?: string;
  hint?: string;
}) {
  return (
    <div
      className="rounded-[var(--radius-sm)] border p-5"
      style={{ borderColor: "var(--warning-line)", background: "var(--warning-soft)" }}
    >
      <p className="flex items-center gap-2 text-[14px] font-medium" style={{ color: "var(--warning-ink)" }}>
        <Dot tone="warning" />
        {title}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--warning-ink)" }}>
        {hint}
      </p>
    </div>
  );
}

/* ---- Buttons / links ---------------------------------------------------- */

export function ActionLink({
  href,
  tone = "accent",
  external = false,
  children,
  className = "",
}: {
  href: string;
  tone?: "accent" | "neutral";
  external?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const style: React.CSSProperties =
    tone === "accent"
      ? { background: "var(--accent)", color: "var(--on-accent)", borderColor: "var(--accent)" }
      : { background: "var(--panel)", color: "var(--text)", borderColor: "var(--border-strong)" };
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${className}`}
      style={style}
    >
      {children}
    </a>
  );
}
