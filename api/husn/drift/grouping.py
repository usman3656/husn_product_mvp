"""Group claims into ClaimGroup rows by (project_id, kind, family_key).

Keys in extractors are intentionally narrow ("launch", "ship", "deadline",
"due", ...). The grouper maps related keys to a single *family* so claims
about the same logical fact land in one group:
  launch | ship | release | go-live | rollout | cutover  →  "release"
  deadline | due | target                               →  "deadline"
  blocked | unblocked | at-risk | on-track              →  "delivery_status"

Anything not mapped goes through verbatim (so adding new keys doesn't lose
data — they just live in their own group until the family map covers them).
"""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Claim, ClaimGroup, ClaimGroupMember

# kind -> {key -> family}
_FAMILIES: dict[str, dict[str, str]] = {
    "date": {
        # All these intents refer to the same logical "when is the thing going live"
        # event — TPMs use "launch date", "ship date", "Target GA", "go-live",
        # "release date" interchangeably for the canonical commitment date.
        # Drift between any two of these in the same project IS the signal.
        "launch": "release",
        "ship": "release",
        "release": "release",
        "go-live": "release",
        "go live": "release",
        "rollout": "release",
        "cutover": "release",
        "target": "release",
        # "deadline" / "due" are kept separate — a deadline is a drop-dead
        # internal date (e.g. "code freeze deadline"), not the launch event.
        "deadline": "deadline",
        "due": "deadline",
    },
    "status": {
        "blocked": "delivery_status",
        "unblocked": "delivery_status",
        "at-risk": "delivery_status",
        "on-track": "delivery_status",
        "issue_status": "delivery_status",
    },
}


def family_key_for(kind: str, key: str) -> str:
    return _FAMILIES.get(kind, {}).get(key, key)


async def get_or_create_group(
    session: AsyncSession, *, project_id: int | None, kind: str, key: str
) -> ClaimGroup:
    # NULL project_id can't use a uniqueness check directly in some dialects;
    # we read-then-insert with conflict-do-nothing for safety.
    result = await session.execute(
        select(ClaimGroup).where(
            ClaimGroup.project_id.is_(project_id) if project_id is None else ClaimGroup.project_id == project_id,
            ClaimGroup.kind == kind,
            ClaimGroup.key == key,
        )
    )
    grp = result.scalar_one_or_none()
    if grp:
        return grp
    grp = ClaimGroup(project_id=project_id, kind=kind, key=key)
    session.add(grp)
    await session.flush()
    return grp


async def assign_unassigned_claims(session: AsyncSession, batch_size: int = 1000) -> dict[str, int]:
    """For every claim with no group membership, assign it to the matching
    (project_id, kind, family_key) group (creating the group if missing).

    Idempotent: re-running yields the same memberships.
    """
    stmt = (
        select(Claim)
        .outerjoin(ClaimGroupMember, ClaimGroupMember.claim_id == Claim.id)
        .where(ClaimGroupMember.claim_id.is_(None))
        .limit(batch_size)
    )
    rows = (await session.execute(stmt)).scalars().all()

    counts = {"considered": len(rows), "assigned": 0, "groups_created": 0}
    for claim in rows:
        family = family_key_for(claim.kind, claim.key)
        existing = await session.execute(
            select(ClaimGroup).where(
                ClaimGroup.project_id.is_(claim.project_id)
                if claim.project_id is None
                else ClaimGroup.project_id == claim.project_id,
                ClaimGroup.kind == claim.kind,
                ClaimGroup.key == family,
            )
        )
        grp = existing.scalar_one_or_none()
        if grp is None:
            grp = ClaimGroup(project_id=claim.project_id, kind=claim.kind, key=family)
            session.add(grp)
            await session.flush()
            counts["groups_created"] += 1

        await session.execute(
            pg_insert(ClaimGroupMember)
            .values(claim_id=claim.id, claim_group_id=grp.id)
            .on_conflict_do_nothing(index_elements=[ClaimGroupMember.claim_id])
        )
        counts["assigned"] += 1

    await session.commit()
    return counts
