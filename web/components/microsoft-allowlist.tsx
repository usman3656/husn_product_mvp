"use client";

import { useEffect, useMemo, useState } from "react";

import { clientFetch } from "@/lib/api";

type MailFolder = {
  id: string;
  name: string;
  total: number | null;
  unread: number | null;
  child_folder_count: number | null;
};

type DriveFolder = {
  id: string;
  name: string;
  modified_time: string | null;
  web_url: string | null;
  owners: string[];
};

type FolderListing = {
  parent_id: string | null;
  file_count: number;
  folders: DriveFolder[];
};

type AllowlistDoc = {
  project_id: number;
  outlook_folders: string[];
  onedrive_folders: string[];
};

type NodeState = {
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  children: DriveFolder[];
  fileCount: number;
};

export function MicrosoftAllowlist() {
  const [mailFolders, setMailFolders] = useState<MailFolder[]>([]);
  const [selectedMail, setSelectedMail] = useState<Set<string>>(new Set());
  const [selectedDrive, setSelectedDrive] = useState<Set<string>>(new Set());
  const [folderNames, setFolderNames] = useState<Map<string, string>>(new Map());
  const [nodeState, setNodeState] = useState<Map<string, NodeState>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [mr, rr, ar] = await Promise.all([
          clientFetch("/api/microsoft/mail-folders"),
          clientFetch("/api/microsoft/folders"),
          clientFetch("/api/microsoft/allowlist"),
        ]);
        const mb = (await mr.json()) as { items: MailFolder[] };
        const rb = (await rr.json()) as FolderListing;
        const ab = (await ar.json()) as AllowlistDoc;
        setMailFolders(mb.items);
        setSelectedMail(new Set(ab.outlook_folders));
        setSelectedDrive(new Set(ab.onedrive_folders));

        const initial = new Map<string, NodeState>();
        initial.set("root", {
          expanded: true,
          loading: false,
          loaded: true,
          children: rb.folders,
          fileCount: rb.file_count,
        });
        setNodeState(initial);

        const names = new Map<string, string>();
        for (const f of rb.folders) names.set(f.id, f.name);
        setFolderNames(names);

        const missing = ab.onedrive_folders.filter((id) => !names.has(id));
        if (missing.length > 0) {
          const metas = await Promise.all(
            missing.map((id) =>
              clientFetch(`/api/microsoft/folders/${id}/metadata`).then(
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
      const next = new Map(nodeState);
      next.set(folderId, { ...cur, expanded: !cur.expanded });
      setNodeState(next);
      return;
    }
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
      const r = await clientFetch(
        `/api/microsoft/folders?parent_id=${encodeURIComponent(folderId)}`,
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
    } catch {
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

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const res = await clientFetch("/api/microsoft/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlook_folders: Array.from(selectedMail),
          onedrive_folders: Array.from(selectedDrive),
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

  const sortedMail = useMemo(
    () =>
      mailFolders.slice().sort((a, b) => {
        // Common system folders at top
        const order = ["Inbox", "Sent Items", "Drafts", "Archive", "Junk Email", "Deleted Items"];
        const ai = order.indexOf(a.name);
        const bi = order.indexOf(b.name);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.name.localeCompare(b.name);
      }),
    [mailFolders],
  );

  if (loading) {
    return (
      <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
        Loading mail folders + OneDrive tree…
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
        {/* Outlook folders */}
        <div>
          <div className="flex items-baseline justify-between">
            <p
              className="text-[10px] uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Outlook folders ({selectedMail.size} selected)
            </p>
            {selectedMail.size > 0 && (
              <button
                onClick={() => setSelectedMail(new Set())}
                className="text-[10px] underline"
                style={{ color: "var(--muted)" }}
              >
                clear
              </button>
            )}
          </div>
          {sortedMail.length === 0 ? (
            <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
              No mail folders found.
            </p>
          ) : (
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
              {sortedMail.map((f) => (
                <MailRow
                  key={f.id}
                  folder={f}
                  selected={selectedMail.has(f.id)}
                  onToggle={() => toggle(selectedMail, f.id, setSelectedMail)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* OneDrive tree */}
        <div>
          <div className="flex items-baseline justify-between">
            <p
              className="text-[10px] uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              OneDrive folders ({selectedDrive.size} selected)
            </p>
            {selectedDrive.size > 0 && (
              <button
                onClick={() => setSelectedDrive(new Set())}
                className="text-[10px] underline"
                style={{ color: "var(--muted)" }}
              >
                clear
              </button>
            )}
          </div>
          <div className="mt-2 max-h-72 overflow-y-auto pr-1">
            <FolderTree
              parentId="root"
              depth={0}
              nodeState={nodeState}
              selected={selectedDrive}
              onExpand={expandNode}
              onToggle={(id) => toggle(selectedDrive, id, setSelectedDrive)}
            />
            <OrphanSelected
              selected={selectedDrive}
              nodeState={nodeState}
              folderNames={folderNames}
              onToggle={(id) => toggle(selectedDrive, id, setSelectedDrive)}
            />
          </div>
        </div>
      </div>

      <div
        className="space-y-2 border-t pt-3"
        style={{ borderColor: "var(--border)" }}
      >
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
            Picking a OneDrive folder watches every file inside it. Nothing is read until
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

function MailRow({
  folder,
  selected,
  onToggle,
}: {
  folder: MailFolder;
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
        <span className="flex-1 truncate" title={folder.name}>
          📥 {folder.name}
        </span>
        {typeof folder.total === "number" && (
          <span style={{ color: "var(--muted)" }}>{folder.total}</span>
        )}
      </label>
    </li>
  );
}

function FolderTree({
  parentId,
  depth,
  nodeState,
  selected,
  onExpand,
  onToggle,
}: {
  parentId: string;
  depth: number;
  nodeState: Map<string, NodeState>;
  selected: Set<string>;
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
        No folders in OneDrive root.
      </p>
    );
  }
  if (state.children.length === 0) return null;

  return (
    <ul className="space-y-0.5">
      {state.children.map((f) => {
        const child = nodeState.get(f.id);
        const expanded = child?.expanded ?? false;
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
              >
                {child?.loading ? "·" : expanded ? "▾" : "▸"}
              </button>
              <input
                type="checkbox"
                checked={selected.has(f.id)}
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
              {child?.loaded && (
                <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                  {child.fileCount} files
                </span>
              )}
            </div>
            {expanded && (
              <FolderTree
                parentId={f.id}
                depth={depth + 1}
                nodeState={nodeState}
                selected={selected}
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

function OrphanSelected({
  selected,
  nodeState,
  folderNames,
  onToggle,
}: {
  selected: Set<string>;
  nodeState: Map<string, NodeState>;
  folderNames: Map<string, string>;
  onToggle: (id: string) => void;
}) {
  if (selected.size === 0) return null;
  const visible = new Set<string>();
  for (const ns of nodeState.values())
    for (const f of ns.children) visible.add(f.id);
  const orphans = Array.from(selected).filter((id) => !visible.has(id));
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
