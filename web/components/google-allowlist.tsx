"use client";

import { useEffect, useMemo, useState } from "react";

const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Label = {
  id: string;
  name: string;
  type: "user" | "system" | null;
  messages_total: number | null;
};
type Folder = {
  id: string;
  name: string;
  modified_time: string | null;
  owners: string[];
};
type FolderListing = {
  parent_id: string;
  file_count: number;
  folders: Folder[];
};
type AllowlistDoc = { project_id: number; labels: string[]; folders: string[] };

type NodeState = {
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  children: Folder[];
  fileCount: number;
};

export function GoogleAllowlist() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [folderNames, setFolderNames] = useState<Map<string, string>>(new Map());
  const [nodeState, setNodeState] = useState<Map<string, NodeState>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initial load: labels + root folders + currently-saved allowlist
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [lr, rr, ar] = await Promise.all([
          fetch(`${BROWSER_API_URL}/api/google/labels`),
          fetch(`${BROWSER_API_URL}/api/google/folders?parent_id=root`),
          fetch(`${BROWSER_API_URL}/api/google/allowlist`),
        ]);
        const lb = (await lr.json()) as { items: Label[] };
        const rb = (await rr.json()) as FolderListing;
        const ab = (await ar.json()) as AllowlistDoc;
        setLabels(lb.items);
        setSelectedLabels(new Set(ab.labels));
        setSelectedFolders(new Set(ab.folders));

        const initial = new Map<string, NodeState>();
        initial.set("root", {
          expanded: true,
          loading: false,
          loaded: true,
          children: rb.folders,
          fileCount: rb.file_count,
        });
        setNodeState(initial);
        // Cache the names of every root child so saved-folder rendering works
        const names = new Map<string, string>();
        for (const f of rb.folders) names.set(f.id, f.name);
        setFolderNames(names);

        // Resolve names for any saved folders we don't yet have a name for
        const missing = ab.folders.filter((id) => !names.has(id));
        if (missing.length > 0) {
          const metas = await Promise.all(
            missing.map((id) =>
              fetch(`${BROWSER_API_URL}/api/google/folders/${id}/metadata`).then(
                (r) => r.json() as Promise<{ id: string; name: string }>,
              ),
            ),
          );
          const next = new Map(names);
          for (const m of metas) next.set(m.id, m.name);
          setFolderNames(next);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function expandNode(folderId: string) {
    const cur = nodeState.get(folderId);
    if (cur?.loaded) {
      // Toggle expansion
      const next = new Map(nodeState);
      next.set(folderId, { ...cur, expanded: !cur.expanded });
      setNodeState(next);
      return;
    }
    // Lazy load
    const next = new Map(nodeState);
    next.set(folderId, {
      expanded: true,
      loading: true,
      loaded: false,
      children: [],
      fileCount: 0,
    });
    setNodeState(next);
    try {
      const r = await fetch(
        `${BROWSER_API_URL}/api/google/folders?parent_id=${encodeURIComponent(folderId)}`,
      );
      const body = (await r.json()) as FolderListing;
      const after = new Map(nodeState);
      after.set(folderId, {
        expanded: true,
        loading: false,
        loaded: true,
        children: body.folders,
        fileCount: body.file_count,
      });
      setNodeState(after);
      const nm = new Map(folderNames);
      for (const f of body.folders) nm.set(f.id, f.name);
      setFolderNames(nm);
    } catch (e) {
      const after = new Map(nodeState);
      after.set(folderId, {
        expanded: false,
        loading: false,
        loaded: false,
        children: [],
        fileCount: 0,
      });
      setNodeState(after);
    }
  }

  function toggleFolder(folderId: string) {
    const next = new Set(selectedFolders);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    setSelectedFolders(next);
  }

  function toggleLabel(labelId: string) {
    const next = new Set(selectedLabels);
    if (next.has(labelId)) next.delete(labelId);
    else next.add(labelId);
    setSelectedLabels(next);
  }

  const userLabels = useMemo(() => labels.filter((l) => l.type === "user"), [labels]);
  const systemLabels = useMemo(
    () => labels.filter((l) => l.type !== "user"),
    [labels],
  );

  async function save() {
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(`${BROWSER_API_URL}/api/google/allowlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labels: Array.from(selectedLabels),
          folders: Array.from(selectedFolders),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const queued = body.backfill_job_id;
      setStatus(
        queued
          ? `Saved. Backfill queued (${queued.slice(0, 8)}). Refresh in ~60s.`
          : "Saved. Syncing will pick this up shortly.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
        Loading labels + Drive tree…
      </p>
    );
  }
  if (error) {
    return (
      <p className="mt-4 text-xs" style={{ color: "var(--danger-ink)" }}>
        {error}
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Labels column */}
        <div>
          <p
            className="text-[10px] uppercase tracking-wide"
            style={{ color: "var(--muted)" }}
          >
            Gmail labels ({selectedLabels.size} selected)
          </p>
          {labels.length === 0 ? (
            <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
              No labels found.
            </p>
          ) : (
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
              {userLabels.map((l) => (
                <LabelRow
                  key={l.id}
                  label={l}
                  selected={selectedLabels.has(l.id)}
                  onToggle={() => toggleLabel(l.id)}
                />
              ))}
              {userLabels.length > 0 && systemLabels.length > 0 && (
                <li
                  className="mt-2 border-t pt-2 text-[10px] uppercase"
                  style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                >
                  System
                </li>
              )}
              {systemLabels.map((l) => (
                <LabelRow
                  key={l.id}
                  label={l}
                  selected={selectedLabels.has(l.id)}
                  onToggle={() => toggleLabel(l.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Drive tree column */}
        <div>
          <div className="flex items-baseline justify-between">
            <p
              className="text-[10px] uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Drive folders ({selectedFolders.size} selected)
            </p>
            {selectedFolders.size > 0 && (
              <button
                onClick={() => setSelectedFolders(new Set())}
                className="text-[10px] underline"
                style={{ color: "var(--muted)" }}
              >
                clear
              </button>
            )}
          </div>
          <div
            className="mt-2 max-h-72 overflow-y-auto pr-1"
            style={{ color: "var(--text)" }}
          >
            <FolderTree
              parentId="root"
              depth={0}
              nodeState={nodeState}
              selectedFolders={selectedFolders}
              folderNames={folderNames}
              onExpand={expandNode}
              onToggle={toggleFolder}
            />
            {/* Render saved folders that aren't visible in the current tree
                (e.g. nested deep) so the user still sees they're selected */}
            <OrphanSelected
              selectedFolders={selectedFolders}
              nodeState={nodeState}
              folderNames={folderNames}
              onToggle={toggleFolder}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        {status && (
          <div
            className="rounded-[var(--radius-sm)] border px-3 py-2 text-[11px]"
            style={{
              borderColor: "var(--success-line)",
              background: "var(--success-soft)",
              color: "var(--success-ink)",
            }}
          >
            {status}
          </div>
        )}
        {error && (
          <div
            className="rounded-[var(--radius-sm)] border px-3 py-2 text-[11px]"
            style={{
              borderColor: "var(--danger-line)",
              background: "var(--danger-soft)",
              color: "var(--danger-ink)",
            }}
          >
            {error}
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>
            Picking a folder watches every Doc and Sheet inside it. Nothing is read until
            you save.
          </p>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-full border px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-50"
            style={{
              borderColor: "var(--accent)",
              color: "var(--on-accent)",
              background: "var(--accent)",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FolderTree({
  parentId,
  depth,
  nodeState,
  selectedFolders,
  folderNames,
  onExpand,
  onToggle,
}: {
  parentId: string;
  depth: number;
  nodeState: Map<string, NodeState>;
  selectedFolders: Set<string>;
  folderNames: Map<string, string>;
  onExpand: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const state = nodeState.get(parentId);
  if (!state) return null;
  if (state.loading) {
    return (
      <p
        className="py-1 text-[11px]"
        style={{ paddingLeft: depth * 16 + 18, color: "var(--muted)" }}
      >
        loading…
      </p>
    );
  }
  if (state.children.length === 0 && parentId === "root") {
    return (
      <p className="py-1 text-[11px]" style={{ color: "var(--muted)" }}>
        No folders in My Drive.
      </p>
    );
  }
  if (state.children.length === 0) return null;

  return (
    <ul className="space-y-0.5">
      {state.children.map((f) => {
        const childState = nodeState.get(f.id);
        const expanded = childState?.expanded ?? false;
        return (
          <li key={f.id}>
            <div
              className="flex items-center gap-1.5 text-[11px]"
              style={{ paddingLeft: depth * 16 }}
            >
              <button
                onClick={() => onExpand(f.id)}
                className="w-3 text-center"
                style={{ color: "var(--muted)" }}
                title={expanded ? "collapse" : "expand"}
              >
                {childState?.loading ? "·" : expanded ? "▾" : "▸"}
              </button>
              <input
                type="checkbox"
                checked={selectedFolders.has(f.id)}
                onChange={() => onToggle(f.id)}
                className="h-3.5 w-3.5"
              />
              <span
                className="flex-1 cursor-pointer truncate"
                onClick={() => onExpand(f.id)}
                title={f.name}
              >
                📁 {f.name}
              </span>
              {childState?.loaded && (
                <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                  {childState.fileCount} files
                </span>
              )}
            </div>
            {expanded && (
              <FolderTree
                parentId={f.id}
                depth={depth + 1}
                nodeState={nodeState}
                selectedFolders={selectedFolders}
                folderNames={folderNames}
                onExpand={onExpand}
                onToggle={onToggle}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Show currently-selected folders that aren't reachable from the rendered
 *  tree (nested deep, or root-not-yet-expanded). Keeps user oriented about
 *  what's actually in their allowlist. */
function OrphanSelected({
  selectedFolders,
  nodeState,
  folderNames,
  onToggle,
}: {
  selectedFolders: Set<string>;
  nodeState: Map<string, NodeState>;
  folderNames: Map<string, string>;
  onToggle: (id: string) => void;
}) {
  if (selectedFolders.size === 0) return null;
  const visibleIds = new Set<string>();
  for (const ns of nodeState.values()) {
    for (const f of ns.children) visibleIds.add(f.id);
  }
  const orphans = Array.from(selectedFolders).filter((id) => !visibleIds.has(id));
  if (orphans.length === 0) return null;
  return (
    <div
      className="mt-3 border-t pt-2"
      style={{ borderColor: "var(--border)" }}
    >
      <p className="text-[10px] uppercase" style={{ color: "var(--muted)" }}>
        Selected (not in current view)
      </p>
      <ul className="mt-1 space-y-0.5">
        {orphans.map((id) => (
          <li key={id} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-3" />
            <input
              type="checkbox"
              checked
              onChange={() => onToggle(id)}
              className="h-3.5 w-3.5"
            />
            <span className="flex-1 truncate" title={id}>
              📁 {folderNames.get(id) ?? id}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LabelRow({
  label,
  selected,
  onToggle,
}: {
  label: Label;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-3.5 w-3.5"
        />
        <span className="flex-1 truncate" title={label.name}>
          {label.name}
        </span>
        {typeof label.messages_total === "number" && (
          <span style={{ color: "var(--muted)" }}>{label.messages_total}</span>
        )}
      </label>
    </li>
  );
}
