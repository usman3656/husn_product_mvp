"""Identity resolution: Slack/Jira user payloads -> a single Person.

Strategy (in order):
  1. Already-known: lookup PersonIdentity by (tenant, source, source_user_id) -> Person.
  2. Email match: if the new identity has an email and a Person with the same
     primary_email exists IN THE SAME TENANT, attach.
  3. Otherwise create a new Person and link this identity.

Tenancy (TENANCY.md C3): every lookup and create is scoped to the tenant
carried by husn.graph.tenancy_context (set per-row by the normalize
dispatcher from raw.tenant_id). None during the AUTH_REQUIRED=0 bridge keeps
behavior identical to pre-tenancy. The email-match step is THE cross-tenant
bleed point if left unscoped — two companies both employing a john@gmail.com
contractor must get two separate Person rows.

Display-name-only matching is intentionally avoided here — too many false
positives (different humans with the same display name). An admin merge tool
lands later (see plan.md Step 2 "needs merging" view).
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Person, PersonIdentity
from husn.graph.tenancy_context import current_tenant_id


async def resolve_or_create_person(
    session: AsyncSession,
    *,
    source: str,
    source_user_id: str,
    display_name: str | None = None,
    email: str | None = None,
    extra: dict | None = None,
    tenant_id: int | None = None,
) -> Person:
    if tenant_id is None:
        tenant_id = current_tenant_id.get()

    # 1. (tenant, source, source_user_id) → known identity?
    ident_q = select(PersonIdentity).where(
        PersonIdentity.source == source,
        PersonIdentity.source_user_id == source_user_id,
    )
    if tenant_id is not None:
        ident_q = ident_q.where(PersonIdentity.tenant_id == tenant_id)
    existing = await session.execute(ident_q)
    identity = existing.scalar_one_or_none()
    if identity:
        person = await session.get(Person, identity.person_id)
        if person:
            # Refresh display/email if we learned something new
            if email and not person.primary_email:
                person.primary_email = email
            if display_name and not person.primary_name:
                person.primary_name = display_name
            return person
        # Identity orphaned (FK not enforced); fall through to create

    # 2. Email match → attach (same tenant only)
    person: Person | None = None
    if email:
        person_q = select(Person).where(func.lower(Person.primary_email) == email.lower())
        if tenant_id is not None:
            person_q = person_q.where(Person.tenant_id == tenant_id)
        result = await session.execute(person_q)
        person = result.scalar_one_or_none()

    # 3. Create
    if person is None:
        person = Person(
            tenant_id=tenant_id,
            primary_name=display_name or source_user_id,
            primary_email=email,
        )
        session.add(person)
        await session.flush()  # populate person.id

    session.add(
        PersonIdentity(
            tenant_id=tenant_id,
            person_id=person.id,
            source=source,
            source_user_id=source_user_id,
            display_name=display_name,
            email=email,
            extra=extra,
        )
    )
    return person
