type Props = {
  sourceKey: "slack" | "jira" | "google" | "microsoft";
  label: string;
};

export function SourcePanel({ sourceKey, label }: Props) {
  return (
    <div
      className="rounded-lg border p-5"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          not connected
        </span>
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        Connect via OAuth to start ingesting artifacts. Source key:{" "}
        <span className="font-mono">{sourceKey}</span>
      </p>
      <div className="mt-4 h-24 rounded border border-dashed text-xs" style={{ borderColor: "var(--border)" }}>
        <div className="flex h-full items-center justify-center" style={{ color: "var(--muted)" }}>
          No artifacts yet.
        </div>
      </div>
    </div>
  );
}
