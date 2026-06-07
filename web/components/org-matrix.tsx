"use client";

import { useMemo, useState } from "react";

/* ============================================================
   OrgMatrix — People × Workstreams.
   A calm grid: rows = people, columns = workstreams.
   Each cell is an intensity dot (none / light / medium / strong)
   based on involvement count. Hover/click reveals the relationship.
   No edges, no node-spaghetti.
   ============================================================ */

export type MatrixPerson = {
  id: number;
  name: string;
  email: string | null;
  initials: string;
  identities: { source: string }[];
};

export type MatrixProject = {
  id: number;
  slug: string;
  name: string;
};

export type MatrixEdge = {
  person_id: number;
  project_id: number;
  total: number;
  dominant_role: "author" | "assignee" | "mention" | "watcher" | string;
};

export function OrgMatrix({
  people,
  projects,
  edges,
}: {
  people: MatrixPerson[];
  projects: MatrixProject[];
  edges: MatrixEdge[];
}) {
  const edgeMap = useMemo(() => {
    const m = new Map<string, MatrixEdge>();
    for (const e of edges) m.set(`${e.person_id}.${e.project_id}`, e);
    return m;
  }, [edges]);

  // Sort people by overall touch volume across visible projects.
  const projectIds = new Set(projects.map((p) => p.id));
  const orderedPeople = useMemo(() => {
    const score = (p: MatrixPerson) =>
      edges
        .filter((e) => e.person_id === p.id && projectIds.has(e.project_id))
        .reduce((acc, e) => acc + e.total, 0);
    return [...people].sort((a, b) => score(b) - score(a)).filter((p) => score(p) > 0).slice(0, 18);
    // We hide people with zero involvement — matrix shows the connected web,
    // not the whole directory.
  }, [people, edges, projectIds]);

  const [hover, setHover] = useState<{ personId: number; projectId: number } | null>(null);

  if (orderedPeople.length === 0 || projects.length === 0) {
    return (
      <EmptyBlock>
        Nobody has been resolved across these workstreams yet. As Husn reads activity,
        people will appear here.
      </EmptyBlock>
    );
  }

  return (
    <div
      className="rounded-[var(--radius-lg)] border overflow-hidden"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      {/* Editorial caption */}
      <div className="px-6 pt-5 pb-3">
        <p className="husn-eyebrow">Organizational Map</p>
        <h3 className="husn-heading mt-2" style={{ fontSize: 19 }}>People × Workstreams</h3>
        <p className="mt-2 text-[13.5px] leading-relaxed max-w-[60ch]" style={{ color: "var(--muted)" }}>
          Each row is a person. Each column a workstream. The size of the mark says
          how present they are in the activity Husn reads.
        </p>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-fit p-4">
          <div
            className="grid items-center gap-1"
            style={{
              gridTemplateColumns: `220px repeat(${projects.length}, 88px)`,
            }}
          >
            {/* Header row */}
            <span aria-hidden />
            {projects.map((p) => (
              <ProjectHeader key={p.id} project={p} active={hover?.projectId === p.id} />
            ))}

            {/* Body rows */}
            {orderedPeople.map((person) => (
              <Row
                key={person.id}
                person={person}
                projects={projects}
                edgeMap={edgeMap}
                onHover={(personId, projectId) => setHover({ personId, projectId })}
                onLeave={() => setHover(null)}
                hover={hover}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Detail strip */}
      <DetailStrip
        person={orderedPeople.find((p) => p.id === hover?.personId) ?? null}
        project={projects.find((p) => p.id === hover?.projectId) ?? null}
        edge={hover ? edgeMap.get(`${hover.personId}.${hover.projectId}`) ?? null : null}
      />
    </div>
  );
}

function ProjectHeader({ project, active }: { project: MatrixProject; active: boolean }) {
  return (
    <div
      className="px-1 pb-2"
      style={{
        textAlign: "center",
        color: active ? "var(--text)" : "var(--muted)",
        transition: "color 160ms ease",
      }}
    >
      <p
        className="truncate text-[11.5px] font-medium"
        title={project.name}
        style={{ maxWidth: 88 }}
      >
        {project.name}
      </p>
      <p className="mt-0.5 text-[9.5px] font-mono uppercase" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>
        {project.slug}
      </p>
    </div>
  );
}

function Row({
  person,
  projects,
  edgeMap,
  onHover,
  onLeave,
  hover,
}: {
  person: MatrixPerson;
  projects: MatrixProject[];
  edgeMap: Map<string, MatrixEdge>;
  onHover: (personId: number, projectId: number) => void;
  onLeave: () => void;
  hover: { personId: number; projectId: number } | null;
}) {
  const activeRow = hover?.personId === person.id;
  return (
    <>
      <div
        className="flex items-center gap-2 px-2 py-1 rounded-[8px]"
        style={{
          background: activeRow ? "var(--panel-2)" : "transparent",
          transition: "background-color 160ms ease",
        }}
      >
        <span
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-full shrink-0 text-[11px] font-semibold"
          style={{ background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          {person.initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-medium" style={{ color: activeRow ? "var(--text)" : "var(--text-2)" }}>{person.name}</p>
        </div>
      </div>
      {projects.map((p) => {
        const e = edgeMap.get(`${person.id}.${p.id}`);
        const isActive = hover?.personId === person.id && hover?.projectId === p.id;
        return (
          <Cell
            key={`${person.id}-${p.id}`}
            edge={e}
            active={isActive}
            onMouseEnter={() => onHover(person.id, p.id)}
            onMouseLeave={onLeave}
            onFocus={() => onHover(person.id, p.id)}
            onBlur={onLeave}
          />
        );
      })}
    </>
  );
}

function Cell({
  edge,
  active,
  ...handlers
}: {
  edge: MatrixEdge | undefined;
  active: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  // Intensity buckets: none, faint, medium, strong, very strong
  const total = edge?.total ?? 0;
  const intensity = total === 0 ? 0 : total < 3 ? 1 : total < 8 ? 2 : total < 20 ? 3 : 4;

  const sizes = [0, 6, 9, 12, 15];
  const fills: string[] = [
    "transparent",
    "var(--understood-soft)",
    "var(--understood)",
    "var(--predicted)",
    "var(--predicted)",
  ];
  const opacities = [0, 0.55, 0.7, 0.85, 1];

  const ring = edge?.dominant_role === "author" || edge?.dominant_role === "assignee";

  return (
    <button
      type="button"
      tabIndex={0}
      {...handlers}
      className="grid place-items-center rounded-[6px] h-9 w-full"
      aria-label={edge ? `${total} touches` : "no involvement"}
      style={{
        background: active ? "var(--panel-2)" : "transparent",
        transition: "background-color 160ms ease",
      }}
    >
      {intensity > 0 ? (
        <span
          aria-hidden
          className="rounded-full"
          style={{
            width: sizes[intensity],
            height: sizes[intensity],
            background: fills[intensity],
            opacity: opacities[intensity],
            boxShadow: ring ? `0 0 0 2px ${active ? "var(--predicted-line)" : "transparent"}` : undefined,
            transition: "box-shadow 200ms ease",
          }}
        />
      ) : (
        <span aria-hidden className="rounded-full" style={{ width: 2, height: 2, background: "var(--border)" }} />
      )}
    </button>
  );
}

function DetailStrip({
  person,
  project,
  edge,
}: {
  person: MatrixPerson | null;
  project: MatrixProject | null;
  edge: MatrixEdge | null;
}) {
  return (
    <div
      className="px-6 py-3 border-t flex items-center gap-3 min-h-[44px]"
      style={{ borderColor: "var(--rule)", background: "var(--panel-2)" }}
    >
      {person && project ? (
        <>
          <span
            className="rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--muted)" }}
          >
            {person.name}
          </span>
          <span aria-hidden style={{ color: "var(--muted-2)" }}>→</span>
          <span
            className="rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--muted)" }}
          >
            {project.name}
          </span>
          <span className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
            {edge ? (
              <>
                {edge.total} touch{edge.total === 1 ? "" : "es"} · primarily{" "}
                <span style={{ color: "var(--text)", fontWeight: 500 }}>{edge.dominant_role}</span>
              </>
            ) : (
              <>not directly involved in this workstream</>
            )}
          </span>
        </>
      ) : (
        <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
          Hover a cell to see how a person relates to a workstream.
        </p>
      )}
    </div>
  );
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius)] border border-dashed px-6 py-10"
      style={{ borderColor: "var(--border-strong)", background: "var(--panel-2)" }}
    >
      <p className="text-[13.5px] leading-relaxed max-w-[58ch]" style={{ color: "var(--muted)" }}>
        {children}
      </p>
    </div>
  );
}
