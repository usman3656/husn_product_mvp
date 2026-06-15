"use client";

/**
 * Renders assistant text with inline `[claim N]` / `[artifact N]` / `[finding N]`
 * markers turned into superscript footnotes. Shared by the full-page Ask Husn
 * surface and the global chat popup so citation rendering stays identical.
 */
export function CitedText({ text }: { text: string }) {
  const parts: (string | { kind: string; id: number; raw: string })[] = [];
  const re = /\[(claim|artifact|finding)\s+(\d+)\]/gi;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    parts.push({ kind: m[1].toLowerCase(), id: Number(m[2]), raw: m[0] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <sup
            key={i}
            className="ml-0.5 mr-0.5 font-mono text-[10px] cursor-help"
            style={{ color: "var(--accent-ink)" }}
            title={`Cited ${p.kind} #${p.id}`}
          >
            [{p.id}]
          </sup>
        ),
      )}
    </>
  );
}
