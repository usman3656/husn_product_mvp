"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

/* ============================================================
   Pulse — the living vitals strip on the Briefing.
   - Numeric counters animate up from 0 on mount
   - Rings draw with stagger + gradient stroke
   - A continuous slow sweep highlight gives "alive" without
     being frantic
   - Each card is hoverable + clickable (jumps to relevant
     Explore lens), and expands a breakdown drawer below the
     strip when active
   ============================================================ */

export type SemanticTone = "aligned" | "uncertain" | "conflict" | "predicted" | "understood";

export type PulseDatum = {
  key: string;
  label: string;
  /** 0..100 if `kind="ring"`, otherwise display value. */
  value: number | string;
  numeric?: number;
  kind: "ring" | "text";
  tone: SemanticTone;
  caption: string;
  /** Editorial breakdown shown when the user opens the card. */
  breakdown: { label: string; value: string }[];
  href?: string;
  /** Optional series for the sparkline (last N normalized values, 0..1). */
  series?: number[];
};

function toneColor(t: SemanticTone) {
  switch (t) {
    case "aligned": return { fill: "var(--aligned)", soft: "var(--aligned-soft)", line: "var(--aligned-line)", ink: "var(--success-ink)" };
    case "uncertain": return { fill: "var(--uncertain)", soft: "var(--uncertain-soft)", line: "var(--uncertain-line)", ink: "var(--warning-ink)" };
    case "conflict": return { fill: "var(--conflict)", soft: "var(--conflict-soft)", line: "var(--conflict-line)", ink: "var(--danger-ink)" };
    case "predicted": return { fill: "var(--predicted)", soft: "var(--predicted-soft)", line: "var(--predicted-line)", ink: "var(--predicted-ink)" };
    case "understood": return { fill: "var(--understood)", soft: "var(--understood-soft)", line: "var(--understood-line)", ink: "var(--accent-ink)" };
  }
}

export function Pulse({ data }: { data: PulseDatum[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = data.find((d) => d.key === openKey) ?? null;

  return (
    <div className="space-y-3">
      <div
        className="grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-[var(--radius-lg)] border"
        style={{ background: "var(--rule)", borderColor: "var(--border)" }}
      >
        {data.map((d, i) => (
          <PulseCard
            key={d.key}
            datum={d}
            isOpen={openKey === d.key}
            onToggle={() => setOpenKey(openKey === d.key ? null : d.key)}
            delay={i * 110}
          />
        ))}
      </div>

      {open ? <Breakdown datum={open} onClose={() => setOpenKey(null)} /> : null}
    </div>
  );
}

/* -------------------- Card -------------------- */

function PulseCard({
  datum,
  isOpen,
  onToggle,
  delay,
}: {
  datum: PulseDatum;
  isOpen: boolean;
  onToggle: () => void;
  delay: number;
}) {
  const c = toneColor(datum.tone);
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative text-left p-6 transition-colors focus:outline-none"
      style={{
        background: "var(--panel)",
        outline: isOpen ? `2px solid ${c.fill}` : undefined,
        outlineOffset: isOpen ? -2 : 0,
      }}
    >
      {/* Slow ambient sweep — only visible on hover, never frantic */}
      {hover ? (
        <span
          aria-hidden
          className="husn-shimmer pointer-events-none absolute inset-0"
          style={{ opacity: 0.5 }}
        />
      ) : null}

      <div className="flex items-center justify-between">
        <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>{datum.label}</p>
        <span
          aria-hidden
          className="text-[10.5px]"
          style={{ color: "var(--muted-2)", opacity: hover || isOpen ? 1 : 0, transition: "opacity 160ms ease" }}
        >
          {isOpen ? "↑" : "↓"}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-5">
        {datum.kind === "ring" ? (
          <Ring value={typeof datum.value === "number" ? datum.value : 0} tone={datum.tone} delay={delay} />
        ) : (
          <BeatDot tone={datum.tone} />
        )}
        <div className="min-w-0 flex-1">
          {datum.kind === "ring" ? (
            <CountUp target={typeof datum.value === "number" ? datum.value : Number(datum.value) || 0} delay={delay} color={c.fill} suffix="%" />
          ) : (
            <p className="tabular" style={{ fontSize: 22, lineHeight: 1.1, letterSpacing: "-0.018em", fontWeight: 600, color: c.fill }}>
              {String(datum.value)}
            </p>
          )}
          <p className="mt-2 text-[12.5px] leading-snug" style={{ color: "var(--text-2)", maxWidth: "22ch" }}>
            {datum.caption}
          </p>

          {/* Sparkline */}
          {datum.series && datum.series.length > 1 ? (
            <Spark series={datum.series} color={c.fill} className="mt-3" />
          ) : null}
        </div>
      </div>
    </button>
  );
}

/* -------------------- Ring -------------------- */

function Ring({ value, tone, delay }: { value: number; tone: SemanticTone; delay: number }) {
  const c = toneColor(tone);
  const r = 26;
  const C = 2 * Math.PI * r;
  const [draw, setDraw] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay;
    const dur = 900;
    const tick = (t: number) => {
      const tt = Math.max(0, Math.min(1, (t - start) / dur));
      const eased = 1 - Math.pow(1 - tt, 3);
      setDraw(eased * value);
      if (tt < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, delay]);

  const offset = C * (1 - draw / 100);
  const gradId = `pulse-grad-${tone}`;

  return (
    <div className="relative shrink-0" style={{ width: 64, height: 64 }}>
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={c.fill} stopOpacity="0.55" />
            <stop offset="100%" stopColor={c.fill} stopOpacity="1" />
          </linearGradient>
          <radialGradient id={`${gradId}-comet`}>
            <stop offset="0%" stopColor={c.fill} stopOpacity="1" />
            <stop offset="100%" stopColor={c.fill} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Backplate ring */}
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--panel-2)" strokeWidth="6" />

        {/* Value arc — drawn on mount, then gently breathes */}
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          transform="rotate(-90 32 32)"
          className="husn-breath"
        />

        {/* Continuous comet — keeps the ring alive */}
        <g className="husn-orbit">
          <circle cx="32" cy="6" r="3.5" fill={`url(#${gradId}-comet)`} opacity="0.9" />
          <circle cx="32" cy="6" r="1.5" fill={c.fill} opacity="1" />
        </g>
      </svg>

      {/* Soft center heartbeat */}
      <span
        aria-hidden
        className="husn-pulse absolute inset-0 m-auto rounded-full"
        style={{ width: 8, height: 8, background: c.fill, top: 28, left: 28 }}
      />
    </div>
  );
}

function BeatDot({ tone }: { tone: SemanticTone }) {
  const c = toneColor(tone);
  return (
    <span
      aria-hidden
      className="husn-pulse inline-block rounded-full shrink-0"
      style={{ width: 14, height: 14, background: c.fill, boxShadow: `0 0 0 6px ${c.soft}` }}
    />
  );
}

/* -------------------- CountUp -------------------- */

function CountUp({ target, delay, color, suffix }: { target: number; delay: number; color: string; suffix?: string }) {
  const [v, setV] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    const dur = 900;
    const tick = (t: number) => {
      if (startedAt.current == null) startedAt.current = t + delay;
      const tt = Math.max(0, Math.min(1, (t - startedAt.current) / dur));
      const eased = 1 - Math.pow(1 - tt, 3);
      setV(Math.round(eased * target));
      if (tt < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delay]);

  return (
    <p className="tabular" style={{ fontSize: 32, lineHeight: 1, letterSpacing: "-0.02em", fontWeight: 600, color }}>
      {v}{suffix ?? ""}
    </p>
  );
}

/* -------------------- Sparkline -------------------- */

function Spark({ series, color, className = "" }: { series: number[]; color: string; className?: string }) {
  const w = 96;
  const h = 22;
  const points = useMemo(() => {
    if (series.length === 0) return "";
    const max = Math.max(...series, 1);
    const min = Math.min(...series, 0);
    const span = Math.max(0.0001, max - min);
    return series
      .map((v, i) => {
        const x = (i / Math.max(1, series.length - 1)) * w;
        const y = h - ((v - min) / span) * h;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [series]);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={className} aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      {/* last point dot */}
      {series.length > 0 ? (() => {
        const last = series[series.length - 1];
        const max = Math.max(...series, 1);
        const min = Math.min(...series, 0);
        const span = Math.max(0.0001, max - min);
        const cy = h - ((last - min) / span) * h;
        return <circle cx={w} cy={cy} r="2" fill={color} />;
      })() : null}
    </svg>
  );
}

/* -------------------- Breakdown drawer -------------------- */

function Breakdown({ datum, onClose }: { datum: PulseDatum; onClose: () => void }) {
  const c = toneColor(datum.tone);
  return (
    <div
      className="rounded-[var(--radius-lg)] border p-6 husn-rise"
      style={{ borderColor: c.line, background: c.soft }}
      role="region"
      aria-label={`${datum.label} breakdown`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="husn-eyebrow" style={{ color: c.ink }}>{datum.label} · breakdown</p>
          <p className="mt-2 text-[15px]" style={{ color: "var(--text)" }}>{datum.caption}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close breakdown"
          className="rounded-full border px-2 py-0.5 text-[11.5px] font-medium"
          style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--muted)" }}
        >
          Close
        </button>
      </div>

      <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {datum.breakdown.map((b, i) => (
          <li
            key={i}
            className="rounded-[10px] border px-3 py-2.5"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          >
            <p className="text-[11.5px]" style={{ color: "var(--muted)" }}>{b.label}</p>
            <p className="mt-1 text-[15.5px] font-medium" style={{ color: "var(--text)" }}>{b.value}</p>
          </li>
        ))}
      </ul>

      {datum.href ? (
        <div className="mt-5">
          <Link
            href={datum.href}
            className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium"
            style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
          >
            Drill in →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
