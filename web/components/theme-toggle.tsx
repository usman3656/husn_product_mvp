"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const ORDER: Theme[] = ["system", "light", "dark"];

function readSaved(): Theme {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem("husn.theme");
  return v === "light" || v === "dark" ? v : "system";
}

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  if (t === "system") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", t);
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("system");

  // Hydrate from the value the inline boot script already set.
  useEffect(() => {
    setTheme(readSaved());
  }, []);

  function setAndPersist(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      if (next === "system") window.localStorage.removeItem("husn.theme");
      else window.localStorage.setItem("husn.theme", next);
    } catch {}
  }

  function cycle() {
    const idx = ORDER.indexOf(theme);
    const next = ORDER[(idx + 1) % ORDER.length];
    setAndPersist(next);
  }

  const label =
    theme === "light" ? "Light" :
    theme === "dark" ? "Dark" : "System";

  if (compact) {
    return (
      <button
        type="button"
        onClick={cycle}
        title={`Theme: ${label}`}
        aria-label={`Theme: ${label}`}
        className="grid h-7 w-7 place-items-center rounded-full border"
        style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--muted)" }}
      >
        {theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Auto />}
      </button>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border p-0.5"
      style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
      role="radiogroup"
      aria-label="Theme"
    >
      <Seg active={theme === "light"} onClick={() => setAndPersist("light")} label="Light"><Sun /></Seg>
      <Seg active={theme === "system"} onClick={() => setAndPersist("system")} label="Auto"><Auto /></Seg>
      <Seg active={theme === "dark"} onClick={() => setAndPersist("dark")} label="Dark"><Moon /></Seg>
    </div>
  );
}

function Seg({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-6 w-7 place-items-center rounded-full transition-colors"
      style={{
        background: active ? "var(--panel)" : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        boxShadow: active ? "var(--shadow-xs)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function Sun() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </svg>
  );
}
function Moon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  );
}
function Auto() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16" />
      <path d="M12 4a8 8 0 0 1 0 16" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Inline no-FOUC boot script — drop this in <head> before the first paint. */
export const THEME_BOOT_SCRIPT = `
(function(){try{
  var t = localStorage.getItem('husn.theme');
  if (t === 'dark' || t === 'light') {
    document.documentElement.setAttribute('data-theme', t);
  }
}catch(e){}})();
`;
