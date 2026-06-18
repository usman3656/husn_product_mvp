"use client";

/* ============================================================
   BriefingCarousel — the briefing as a presented deck.

   One section fills the stage; advance by click / arrow / wheel / swipe /
   edge buttons / progress rail. Each slide is a composed scene (big section
   header + a giant watermark word + a per-section colour wash) that arrives
   with a cinematic zoom. Extras: autoplay with a timer, and a zoom-out
   overview grid. A "Scroll view" toggle drops back to the stacked page
   (also the reduced-motion / screen-reader path).

   The page (a server component) renders each section's JSX and hands it in as
   slides[].node, so all data + derivations stay on the server. This is the
   presentation shell only.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from "react";

export type CarouselSlide = {
  id: string;
  /** small index label, e.g. "01" */
  kicker?: string;
  /** section heading */
  title?: string;
  /** big faint background word — defaults to the kicker */
  watermark?: string;
  /** one-line description shown in the overview grid */
  summary?: string;
  /** semantic accent (CSS colour/var) for the wash + overview accent */
  tone?: string;
  node: React.ReactNode;
};

const INTERACTIVE = 'a,button,input,textarea,select,label,[role="button"],[data-no-advance]';
const FOCUSABLE = 'a,button,input,textarea,select,[role="button"],[contenteditable="true"]';
const AUTOPLAY_MS = 7000;

export function BriefingCarousel({
  slides,
  title = "Today's briefing",
  dateLabel,
  refreshedLabel,
  headerSlot,
}: {
  slides: CarouselSlide[];
  title?: string;
  dateLabel: string;
  refreshedLabel: string;
  headerSlot?: React.ReactNode;
}) {
  const n = slides.length;
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [mode, setMode] = useState<"deck" | "scroll">("deck");
  const [overview, setOverview] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [moved, setMoved] = useState(false);
  const [live, setLive] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const wheelLock = useRef(false);
  const wheelTimer = useRef<number | undefined>(undefined);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const go = useCallback(
    (to: number, d: 1 | -1) => {
      setIndex((cur) => {
        const t = Math.max(0, Math.min(n - 1, to));
        if (t !== cur) {
          setDir(d);
          setMoved(true);
        }
        return t;
      });
    },
    [n],
  );
  const next = useCallback(() => go(index + 1, 1), [go, index]);
  const prev = useCallback(() => go(index - 1, -1), [go, index]);

  // Keyboard navigation. Bail when a control is focused so Enter/Space/arrows
  // activate that control instead of being hijacked to advance the deck.
  useEffect(() => {
    if (mode !== "deck") return;
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      // Never navigate while typing.
      if (a && a.closest("input,textarea,[contenteditable='true']")) return;
      // Let Enter/Space activate a focused control (a link/button) natively —
      // but every other key (arrows, Escape, Home/End, digits) still navigates,
      // so focus lingering on a chrome button never traps the keyboard.
      if ((e.key === " " || e.key === "Enter") && a && a.closest(FOCUSABLE)) return;
      if (overview) {
        if (e.key === "Escape") { e.preventDefault(); setOverview(false); }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setOverview(true); return; }
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        index >= n - 1 ? go(0, -1) : next();
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        prev();
      } else if (e.key === "Home") { e.preventDefault(); go(0, -1); }
      else if (e.key === "End") { e.preventDefault(); go(n - 1, 1); }
      else if (/^[1-9]$/.test(e.key)) { const i = Number(e.key) - 1; if (i < n) go(i, i > index ? 1 : -1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, overview, next, prev, go, n, index]);

  // On slide change: reset scroll, announce, and move focus (not on first mount).
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    const s = slides[index];
    setLive(`Section ${index + 1} of ${n}${s.title ? `: ${s.title}` : ""}`);
    if (moved && !overview) slideRef.current?.focus({ preventScroll: true });
  }, [index, slides, n, moved, overview]);

  // Autoplay — advances on a timer; pauses behind a modal, while hidden, in
  // overview/scroll mode. Advancing this way doesn't steal focus.
  useEffect(() => {
    if (!playing || mode !== "deck" || overview) return;
    const id = window.setInterval(() => {
      if (document.hidden || document.querySelector('[role="dialog"]')) return;
      setDir(1);
      setIndex((cur) => (cur >= n - 1 ? 0 : cur + 1));
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [playing, mode, overview, n]);

  useEffect(() => () => window.clearTimeout(wheelTimer.current), []);

  // Wheel: navigate only at the slide's scroll boundaries.
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) < 8) return;
    const el = scrollerRef.current;
    if (el) {
      const atTop = el.scrollTop <= 1;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (e.deltaY > 0 && !atBottom) return;
      if (e.deltaY < 0 && !atTop) return;
    }
    if (wheelLock.current) return;
    wheelLock.current = true;
    wheelTimer.current = window.setTimeout(() => (wheelLock.current = false), 650);
    e.deltaY > 0 ? next() : prev();
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? next() : prev();
  };

  const onStageClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    next();
  };

  if (mode === "scroll") {
    return (
      <ScrollView
        slides={slides}
        dateLabel={dateLabel}
        refreshedLabel={refreshedLabel}
        onDeck={() => setMode("deck")}
      />
    );
  }

  const slide = slides[index];
  const atEnd = index === n - 1;
  const tone = slide.tone ?? "var(--accent)";

  return (
    <section
      className="brf-stage"
      role="group"
      aria-roledescription="carousel"
      aria-label="Today's briefing"
    >
      <div aria-live="polite" className="sr-only">{live}</div>

      {/* Per-section colour wash (cross-fades as the tone changes). */}
      <div
        key={`wash-${index}`}
        className="brf-wash"
        aria-hidden
        style={{ background: `radial-gradient(120% 80% at 82% -12%, color-mix(in srgb, ${tone} 11%, transparent), transparent 58%)` }}
      />

      {/* Autoplay timer bar. */}
      {playing ? <div key={`auto-${index}`} className="brf-autobar" aria-hidden /> : null}

      {/* Top bar */}
      <header className="brf-top">
        <div className="brf-meta">
          <span className="brf-title">{title}</span>
          <span className="brf-dot" aria-hidden>·</span>
          <span className="husn-meta">{dateLabel}</span>
          <span className="brf-dot brf-dot-hide" aria-hidden>·</span>
          <span className="husn-meta brf-dot-hide">refreshed {refreshedLabel}</span>
        </div>
        <div className="brf-rail" aria-label="Jump to section">
          {slides.map((s, i) => (
            <button
              key={s.id}
              aria-label={`Go to section ${i + 1}${s.title ? `: ${s.title}` : ""}`}
              aria-current={i === index ? "true" : undefined}
              className="brf-seg"
              data-state={i === index ? "on" : i < index ? "past" : "future"}
              onClick={() => go(i, i > index ? 1 : -1)}
            >
              <span className="brf-seg-track"><span className="brf-seg-fill" /></span>
            </button>
          ))}
        </div>
        <div className="brf-topright">
          {headerSlot}
          <button className="brf-ctl" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause autoplay" : "Play sections"} aria-pressed={playing}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="brf-ctl" onClick={() => setOverview(true)} aria-label="Overview of all sections">
            <GridIcon />
          </button>
          <span className="brf-count tabular">
            {String(index + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
          </span>
          <button className="brf-toggle" onClick={() => setMode("scroll")} aria-label="Switch to scroll view">
            Scroll view
          </button>
        </div>
      </header>

      {/* Overview grid OR the active slide */}
      {overview ? (
        <Overview slides={slides} index={index} onPick={(i) => { setOverview(false); go(i, i > index ? 1 : -1); }} onClose={() => setOverview(false)} />
      ) : (
        <>
          <div
            className="brf-center"
            ref={scrollerRef}
            onClick={onStageClick}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div
              key={index}
              ref={slideRef}
              tabIndex={-1}
              className="brf-slide"
              data-dir={dir}
              aria-label={slide.title ?? "Overview"}
            >
              <div className="brf-canvas">
                <span className="brf-watermark" aria-hidden>{slide.watermark ?? slide.kicker}</span>
                {slide.title ? (
                  <div className="brf-slidehead">
                    {slide.kicker ? <span className="brf-kicker tabular" style={{ color: tone }}>{slide.kicker}</span> : null}
                    <h2 className="brf-h2">{slide.title}</h2>
                  </div>
                ) : null}
                <div className="brf-body">{slide.node}</div>
              </div>
            </div>
          </div>

          <button className="brf-edge brf-edge-l" onClick={prev} disabled={index === 0} aria-label="Previous section">
            <Chevron dir="left" />
          </button>
          <button className="brf-edge brf-edge-r" onClick={atEnd ? () => go(0, -1) : next} aria-label={atEnd ? "Back to start" : "Next section"}>
            {atEnd ? <Restart /> : <Chevron dir="right" />}
          </button>

          <footer className="brf-bottom">
            <button className="brf-mnav" onClick={prev} disabled={index === 0} aria-label="Previous section"><Chevron dir="left" /></button>
            <span className="brf-hint" data-faded={moved ? "1" : "0"}>
              {atEnd ? "You're all caught up — press → to start over" : "Click anywhere, swipe, or use ← →"}
            </span>
            <button className="brf-mnav" onClick={atEnd ? () => go(0, -1) : next} aria-label={atEnd ? "Back to start" : "Next section"}>
              {atEnd ? <Restart /> : <Chevron dir="right" />}
            </button>
          </footer>
        </>
      )}
    </section>
  );
}

/* ---- Overview: zoom out to every section, click to zoom in ---- */
function Overview({
  slides,
  index,
  onPick,
  onClose,
}: {
  slides: CarouselSlide[];
  index: number;
  onPick: (i: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="brf-overview">
      <div className="brf-ovbar">
        <p className="husn-eyebrow">All sections</p>
        <button className="brf-toggle" onClick={onClose} aria-label="Close overview">Done</button>
      </div>
      <div className="brf-grid">
        {slides.map((s, i) => {
          const tone = s.tone ?? "var(--accent)";
          return (
            <button
              key={s.id}
              className="brf-ocard"
              aria-current={i === index ? "true" : undefined}
              style={{ ["--brf-otone" as string]: tone }}
              onClick={() => onPick(i)}
            >
              <span className="brf-ocard-accent" aria-hidden />
              <span className="brf-owm tabular" aria-hidden>{s.watermark ?? s.kicker}</span>
              {s.kicker ? <span className="brf-ocard-kicker tabular" style={{ color: tone }}>{s.kicker}</span> : null}
              <span className="brf-ocard-title">{s.title}</span>
              {s.summary ? <span className="brf-ocard-sum">{s.summary}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Scroll-view fallback: the classic stacked page ---- */
function ScrollView({
  slides,
  dateLabel,
  refreshedLabel,
  onDeck,
}: {
  slides: CarouselSlide[];
  dateLabel: string;
  refreshedLabel: string;
  onDeck: () => void;
}) {
  return (
    <main className="mx-auto px-6 lg:px-12 pt-10 pb-32" style={{ maxWidth: 1100 }}>
      <div className="flex items-center justify-between gap-4">
        <p className="husn-meta">{dateLabel} · refreshed {refreshedLabel}</p>
        <button className="brf-toggle" onClick={onDeck} aria-label="Switch to slideshow view">Slideshow view</button>
      </div>
      {slides.map((s, i) => (
        <section key={s.id} className="mt-12 husn-rise" style={{ animationDelay: `${i * 40}ms` }}>
          {s.title ? (
            <div className="flex items-baseline gap-3 mb-5">
              {s.kicker ? <span className="tabular text-[11px] font-medium" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>{s.kicker}</span> : null}
              <h2 className="husn-heading" style={{ fontSize: 22 }}>{s.title}</h2>
            </div>
          ) : null}
          {s.node}
        </section>
      ))}
    </main>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {dir === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  );
}
function Restart() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
    </svg>
  );
}
function PlayIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden><path d="M7 5v14l11-7z" /></svg>;
}
function PauseIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>;
}
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
