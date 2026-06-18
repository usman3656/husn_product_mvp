"use client";

/* ============================================================
   BriefingCarousel — the briefing as a presented deck.

   The homepage used to scroll. This turns it into a slideshow that
   comes *to* you: one section fills the stage, you advance by click /
   arrow / swipe / wheel, and each slide arrives with a cinematic
   reveal. A progress rail lets you jump anywhere; a "Scroll view"
   toggle drops back to the classic stacked page (also the a11y path).

   The page (a server component) renders each section's JSX and hands
   them in as `slides[].node`, so all data + derivations stay on the
   server. This component is purely the presentation shell.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from "react";

export type CarouselSlide = {
  id: string;
  /** small index label, e.g. "01" — omit on the intro/hero slide */
  kicker?: string;
  /** section heading — omit on the intro/hero slide */
  title?: string;
  node: React.ReactNode;
};

const INTERACTIVE = 'a,button,input,textarea,select,label,[role="button"],[data-no-advance]';

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
  /** Optional actions rendered in the top bar (e.g. a Connections link). */
  headerSlot?: React.ReactNode;
}) {
  const n = slides.length;
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [mode, setMode] = useState<"deck" | "scroll">("deck");
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
  // activate that control (Investigate link, Reach Out, etc.) instead of being
  // hijacked to advance the deck — and so an open modal keeps its own keys.
  useEffect(() => {
    if (mode !== "deck") return;
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      if (a && a.closest('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        index >= n - 1 ? go(0, -1) : next(); // forward at the end wraps to start
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        prev();
      } else if (e.key === "Home") {
        e.preventDefault();
        go(0, -1);
      } else if (e.key === "End") {
        e.preventDefault();
        go(n - 1, 1);
      } else if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < n) go(i, i > index ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, next, prev, go, n, index]);

  // On slide change: reset scroll, announce to screen readers via a stable live
  // region, and move focus to the slide (keyboard/SR users) — but not on first
  // mount (don't steal focus on load).
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    const s = slides[index];
    setLive(`Section ${index + 1} of ${n}${s.title ? `: ${s.title}` : ""}`);
    if (moved) slideRef.current?.focus({ preventScroll: true });
  }, [index, slides, n, moved]);

  // Clean up the wheel debounce timer on unmount.
  useEffect(() => () => window.clearTimeout(wheelTimer.current), []);

  // Wheel: only treat as navigation when the slide can't scroll further in
  // that direction (so a tall slide scrolls naturally first, then advances).
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) < 8) return;
    const el = scrollerRef.current;
    if (el) {
      const atTop = el.scrollTop <= 1;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (e.deltaY > 0 && !atBottom) return; // let it scroll down
      if (e.deltaY < 0 && !atTop) return; // let it scroll up
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
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      dx < 0 ? next() : prev();
    }
  };

  // Click on empty stage advances; clicks on links/buttons/selected text don't.
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

  return (
    <section
      className="brf-stage"
      role="group"
      aria-roledescription="carousel"
      aria-label="Today's briefing"
    >
      {/* Stable live region for screen-reader announcements on slide change. */}
      <div aria-live="polite" className="sr-only">{live}</div>

      {/* Top: deck identity + progress rail + actions */}
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
          <span className="brf-count tabular">
            {String(index + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
          </span>
          <button className="brf-toggle" onClick={() => setMode("scroll")} aria-label="Switch to scroll view">
            Scroll view
          </button>
        </div>
      </header>

      {/* Center stage */}
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
            {slide.kicker ? <span className="brf-watermark tabular" aria-hidden>{slide.kicker}</span> : null}
            {slide.title ? (
              <div className="brf-slidehead">
                {slide.kicker ? <span className="brf-kicker tabular">{slide.kicker}</span> : null}
                <h2 className="brf-h2">{slide.title}</h2>
              </div>
            ) : null}
            <div className="brf-body">{slide.node}</div>
          </div>
        </div>
      </div>

      {/* Edge chevrons */}
      <button
        className="brf-edge brf-edge-l"
        onClick={prev}
        disabled={index === 0}
        aria-label="Previous section"
      >
        <Chevron dir="left" />
      </button>
      <button
        className="brf-edge brf-edge-r"
        onClick={atEnd ? () => go(0, -1) : next}
        aria-label={atEnd ? "Back to start" : "Next section"}
      >
        {atEnd ? <Restart /> : <Chevron dir="right" />}
      </button>

      {/* Bottom: hint, plus prev/next controls for touch (edge chevrons are
          hidden on small screens). */}
      <footer className="brf-bottom">
        <button className="brf-mnav" onClick={prev} disabled={index === 0} aria-label="Previous section">
          <Chevron dir="left" />
        </button>
        <span className="brf-hint" data-faded={moved ? "1" : "0"}>
          {atEnd ? "You're all caught up — press → to start over" : "Click anywhere, swipe, or use ← →"}
        </span>
        <button className="brf-mnav" onClick={atEnd ? () => go(0, -1) : next} aria-label={atEnd ? "Back to start" : "Next section"}>
          {atEnd ? <Restart /> : <Chevron dir="right" />}
        </button>
      </footer>
    </section>
  );
}

/* ---- Scroll-view fallback: the classic stacked page + a way back ---- */
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
        <p className="husn-meta">
          {dateLabel} · refreshed {refreshedLabel}
        </p>
        <button className="brf-toggle" onClick={onDeck} aria-label="Switch to slideshow view">
          Slideshow view
        </button>
      </div>
      {slides.map((s, i) => (
        <section key={s.id} className="mt-12 husn-rise" style={{ animationDelay: `${i * 40}ms` }}>
          {s.title ? (
            <div className="flex items-baseline gap-3 mb-5">
              {s.kicker ? (
                <span className="tabular text-[11px] font-medium" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>
                  {s.kicker}
                </span>
              ) : null}
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
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}
