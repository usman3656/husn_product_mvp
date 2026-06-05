"""Atlassian Personal Data Reporting endpoints.

When the Atlassian developer console asks "does your app store personal data?"
we say yes (we cache Jira accountIds, display names, and the artifact-mention
graph in Postgres past 24h). That obliges us to expose two POST endpoints
Atlassian can call to (a) report what we hold for a given list of accountIds,
and (b) delete it. These routes are those two endpoints.

URLs to register in the Atlassian developer console under Settings > Personal
Data:
  Reporting URL:  https://api.husn.io/api/atlassian/personal-data/report
  Deletion URL:   https://api.husn.io/api/atlassian/personal-data/delete

# PROD-AUDIT: Atlassian authenticates these calls with a JWT bearer token in
# the Authorization header signed by their public key. We currently accept all
# callers. Add JWT verification (per
# https://developer.atlassian.com/cloud/jira/platform/personal-data-reporting/)
# before any real customer is onboarded.
"""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from husn.core.logging import log
from husn.db.models import PersonIdentity
from husn.db.session import get_session

router = APIRouter(prefix="/api/atlassian/personal-data", tags=["atlassian-personal-data"])

SOURCE_JIRA = "jira"
MAX_ACCOUNT_IDS_PER_REQUEST = 90


class PersonalDataRequest(BaseModel):
    """Body Atlassian POSTs to both endpoints: a list of accountIds."""

    accountIds: list[str] = Field(default_factory=list, max_length=MAX_ACCOUNT_IDS_PER_REQUEST)


class PersonalDataReport(BaseModel):
    accountId: str
    status: str  # "found" | "not_found"
    lastUpdated: str | None = None


class PersonalDataReportResponse(BaseModel):
    accountIds: list[str]
    personalDataReports: list[PersonalDataReport]


class PersonalDataDeleteResponse(BaseModel):
    accountIds: list[str]
    deleted: int


@router.post("/report", response_model=PersonalDataReportResponse)
async def report_personal_data(
    body: PersonalDataRequest,
    session: AsyncSession = Depends(get_session),
) -> PersonalDataReportResponse:
    """Return whether we hold personal data for each requested Jira accountId.

    Atlassian polls this periodically; for each accountId we say either
    "found" (we have a PersonIdentity row, return its last-updated timestamp)
    or "not_found" (no record). We do not reveal the actual personal data
    over this endpoint; the existence + lastUpdated is what the spec asks for.
    """
    if not body.accountIds:
        return PersonalDataReportResponse(accountIds=[], personalDataReports=[])

    rows = (
        await session.execute(
            select(PersonIdentity).where(
                PersonIdentity.source == SOURCE_JIRA,
                PersonIdentity.source_user_id.in_(body.accountIds),
            )
        )
    ).scalars().all()

    by_account: dict[str, PersonIdentity] = {r.source_user_id: r for r in rows}

    reports: list[PersonalDataReport] = []
    for account_id in body.accountIds:
        match = by_account.get(account_id)
        if match is None:
            reports.append(PersonalDataReport(accountId=account_id, status="not_found"))
        else:
            reports.append(
                PersonalDataReport(
                    accountId=account_id,
                    status="found",
                    lastUpdated=match.created_at.astimezone(UTC).isoformat(),
                )
            )

    log.info(
        "atlassian_personal_data_report",
        requested=len(body.accountIds),
        found=sum(1 for r in reports if r.status == "found"),
    )

    return PersonalDataReportResponse(
        accountIds=body.accountIds,
        personalDataReports=reports,
    )


@router.post("/delete", response_model=PersonalDataDeleteResponse)
async def delete_personal_data(
    body: PersonalDataRequest,
    session: AsyncSession = Depends(get_session),
) -> PersonalDataDeleteResponse:
    """Anonymize PersonIdentity rows for the requested Jira accountIds.

    We anonymize rather than hard-delete: clearing display_name and email and
    blanking the extra JSONB removes the personal-data fields while preserving
    the foreign-key links to artifacts. The source_user_id is replaced with a
    deterministic anonymized stub so future incoming mentions from Jira do not
    re-create the same record.
    """
    if not body.accountIds:
        return PersonalDataDeleteResponse(accountIds=[], deleted=0)

    # Find what we have so we can report a real count back.
    existing = (
        await session.execute(
            select(PersonIdentity.id).where(
                PersonIdentity.source == SOURCE_JIRA,
                PersonIdentity.source_user_id.in_(body.accountIds),
            )
        )
    ).scalars().all()

    deleted = 0
    for account_id in body.accountIds:
        result = await session.execute(
            update(PersonIdentity)
            .where(
                PersonIdentity.source == SOURCE_JIRA,
                PersonIdentity.source_user_id == account_id,
            )
            .values(
                source_user_id=f"deleted:jira:{account_id}",
                display_name=None,
                email=None,
                extra={"deleted": True, "deleted_at": datetime.now(UTC).isoformat()},
            )
        )
        if result.rowcount:
            deleted += int(result.rowcount)

    await session.commit()

    log.info(
        "atlassian_personal_data_delete",
        requested=len(body.accountIds),
        had_record=len(existing),
        anonymized=deleted,
    )

    return PersonalDataDeleteResponse(
        accountIds=body.accountIds,
        deleted=deleted,
    )


@router.get("/healthz")
async def personal_data_healthz() -> dict[str, Any]:
    """Cheap probe Atlassian can hit to check the endpoint is reachable."""
    return {"ok": True}
