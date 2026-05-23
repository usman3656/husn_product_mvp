"""Identity resolution: Slack/Jira user payloads -> a single Person.

Strategy (in order):
  1. Already-known: lookup PersonIdentity by (source, source_user_id) -> Person.
  2. Email match: if the new identity has an email and a Person with the same
     primary_email exists, attach.
  3. Otherwise create a new Person and link this identity.

Display-name-only matching is intentionally avoided here — too many false
positives (different humans with the same display name). An admin merge tool
lands later (see plan.md Step 2 "needs merging" view).
"""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Person, PersonIdentity


async def resolve_or_create_person(
    session: AsyncSession,
    *,
    source: str,
    source_user_id: str,
    display_name: str | None = None,
    email: str | None = None,
    extra: dict | None = None,
) -> Person:
    # 1. (source, source_user_id) → known identity?
    existing = await session.execute(
        select(PersonIdentity).where(
            PersonIdentity.source == source,
            PersonIdentity.source_user_id == source_user_id,
        )
    )
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

    # 2. Email match → attach
    person: Person | None = None
    if email:
        result = await session.execute(
            select(Person).where(func.lower(Person.primary_email) == email.lower())
        )
        person = result.scalar_one_or_none()

    # 3. Create
    if person is None:
        person = Person(
            primary_name=display_name or source_user_id,
            primary_email=email,
        )
        session.add(person)
        await session.flush()  # populate person.id

    session.add(
        PersonIdentity(
            person_id=person.id,
            source=source,
            source_user_id=source_user_id,
            display_name=display_name,
            email=email,
            extra=extra,
        )
    )
    return person
