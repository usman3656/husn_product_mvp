You are helping me design and build SyncGuard.

Read this carefully before making architectural or product decisions.

# What SyncGuard Actually Is

SyncGuard is NOT:

* a Jira replacement
* a generic PM tool
* an AI meeting summarizer
* an employee monitoring platform
* an “AI manager”
* a dashboard company
* a generic Slack copilot

SyncGuard IS:
A human-supervised operational coordination layer for cross-functional enterprise programs.

The core problem:
Organizations do not fail because information does not exist.
They fail because important operational changes do not propagate into shared understanding across teams, tools, documents, approvals, assumptions, and timelines.

Meetings often exist because teams are manually reconstructing operational truth.

People ask:

* What changed?
* Who knows?
* Is this still the date?
* Did Security approve it?
* Did QA acknowledge the impact?
* Why does the deck say one thing while Slack says another?
* Is Jira actually current?
* Which source should we trust?

SyncGuard exists to detect and reduce operational drift before it becomes a meeting surprise or release failure.

# The Product Thesis

Jira shows declared work.
SyncGuard checks whether changes in declared work have propagated into shared operational understanding.

That distinction is critical.

Example:
Jira may show:
“Launch date changed from June 3 to June 10.”

SyncGuard asks:

* Did QA acknowledge the compressed testing window?
* Did Ops update the cutover runbook?
* Did Finance update validation timelines?
* Did Support receive updated enablement materials?
* Do meeting notes still reference June 3?
* Are there conflicting source signals?

The product is fundamentally about:

* operational propagation
* acknowledgment
* dependency coordination
* confidence in operational state
* evidence-backed alignment

# Product Modes

SyncGuard has six operational modes:

1. Detect
   What changed?
   What conflicts?
   What became stale?

2. Propagate
   Who needs to know?

3. Confirm
   Who acknowledged the impact?

4. Resolve
   What still needs clarification or resolution?

5. Forecast
   Which unresolved patterns may become operational risk?

6. Inform
   Who should be notified, and when?

The core operational loop is:

Change happens
→ affected people/artifacts identified
→ confirmations requested
→ conflicts resolved
→ confidence updated
→ risks forecasted
→ right people informed

# Product Philosophy

The product should feel like:

* operational infrastructure
* coordination middleware
* a control plane for cross-functional execution
* organizational synchronization infrastructure

NOT:

* another AI assistant
* another dashboard
* another chat bot
* another PM SaaS

The moat is NOT:

* LLM summaries
* connectors
* dashboards

The moat is:

* operational graph
* propagation logic
* dependency topology
* evidence lineage
* acknowledgment tracking
* organizational confidence modeling

# Important UI / Language Rules

GOOD language:

* dependency drift
* missing acknowledgment
* stale assumption
* conflicting source signal
* needs clarification
* confidence low
* recommended agenda item
* unresolved dependency
* awaiting confirmation

BAD language:

* bad team
* employee bottleneck
* underperforming owner
* no response from employee
* blame-oriented wording
* surveillance-oriented wording

The product must NEVER feel like employee monitoring software.

# The Simulator Vision

We are building a realistic fake enterprise simulation environment BEFORE connecting to real customer environments.

The simulator is extremely important.
It is not toy demo data.

It should simulate:

* fragmented operational truth
* changing assumptions
* stale documents
* conflicting evidence
* incomplete propagation
* ambiguous decisions
* human coordination failure

The simulator should feel like a real enterprise program under pressure.

# Demo Program

Project Atlas — Enterprise Billing Migration

Scenario:
A company is migrating its enterprise billing / lead-to-cash platform.

Teams involved:

* Product
* Engineering
* QA
* Security
* Operations
* Finance
* Customer Support
* Program Management

Fake personas:

* Nina Patel — Product Lead
* Aaron Brooks — Engineering Lead
* Samir Rao — QA Lead
* Elena Torres — Security Lead
* David Kim — Ops Manager
* Priya Shah — Finance Lead
* Marcus Reed — Support Enablement Lead
* Jordan Lee — Program Manager

# Core Seeded Contradiction

Launch date moved from June 3 to June 10, but not every source/team caught up.

That contradiction should propagate through:

* Jira
* Slack
* Google Docs
* Google Sheets
* Gmail
* meeting notes
* status packs
* dependency trackers
* risk registers
* runbooks
* enablement docs

# Required Source Types

The simulation environment should create realistic enterprise artifacts.

1. Jira

* epics
* stories
* blockers
* comments
* status changes
* dependency tickets

2. Slack

* persona-to-persona conversations
* threads
* concerns
* clarifications
* unresolved assumptions
* program manager nudges

3. Google Docs

* launch plans
* runbooks
* QA plans
* support enablement docs
* steering status docs
* customer comms plans

4. Google Sheets / Excel-style artifacts

* dependency tracker
* risk register
* launch readiness tracker
* validation exceptions
* training attendance
* cutover tracker

5. Meeting Notes / AI Notetaker style transcripts
   Think:
   Granola / AI meeting note systems.

These are VERY important evidence sources.

Meeting notes should contain:

* stale assumptions
* ambiguous language
* unresolved decisions
* partially outdated summaries

6. Gmail

* validation threads
* approval discussions
* escalation emails
* clarification requests

7. Optional Notion/Confluence later

# The Operational Graph

SyncGuard should eventually maintain a normalized operational graph of:

* people
* teams
* dependencies
* approvals
* assumptions
* artifacts
* claims
* timelines
* decisions
* acknowledgments
* conflicts

This graph matters more than the UI.

# Claims + Evidence

Every artifact should generate claims.

Examples:

* “Launch date is June 10”
* “Security approval is blocked”
* “Finance validation complete”
* “7 validation exceptions remain”
* “QA regression window compressed to 3 days”

Claims may:

* support each other
* conflict
* become stale
* remain uncertain

SyncGuard’s job is to reason about operational confidence from claims/evidence.

# Simulation Rounds

Round 0 — baseline
Everything aligned around June 3.

Round 1
Launch date changes in Jira and Product comms.

Round 2
QA raises compressed regression concern.

Round 3
Security approval blocked.

Round 4
Ops runbook stale.

Round 5
Finance email conflicts with steering status pack.

Round 6
Support enablement outdated.

Round 7
Program manager prepares sync and SyncGuard generates alignment state.

# What Success Looks Like

The demo should feel like:
“Holy shit, this actually feels like a real enterprise program.”

NOT:
“Here are some fake charts.”

A strong SyncGuard moment is:

* Jira changed
* Slack concern appeared
* Docs remained stale
* meeting notes contradicted new state
* acknowledgment missing
* confidence dropped
* SyncGuard identified impacted teams
* SyncGuard generated clarification requests
* SyncGuard changed the meeting agenda

That is the product.

# Technical Direction

Current app:

* Next.js
* TypeScript
* Tailwind
* local JSON first
* simple architecture first
* avoid overengineering

Simulation should support:

* dry-run mode
* baseline seeding
* round-by-round execution
* source syncing
* evidence normalization
* alignment state generation

Potential commands:

* npm run sim:dry-run
* npm run sim:seed
* npm run sim:round -- 1
* npm run sync:sources
* npm run sync:brief

Use deterministic/rule-based logic first.
Do not rely on LLM magic for core operational logic yet.

# Most Important Principle

Do not optimize for:
“AI-generated summaries.”

Optimize for:
“Evidence-backed operational synchronization.”

The product should ultimately feel less like:
“AI PM assistant”

and more like:
“The missing synchronization layer between enterprise systems and enterprise reality.”