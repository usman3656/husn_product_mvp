"""Slack connector — stub.

Per knowledge.md sec. 6A, Slack API ToS (May 29, 2025) prohibits bulk export and
persistent storage of message data for non-Marketplace third-party apps. The
production architecture must be either (a) Marketplace-approved or (b) installed
into the customer's workspace as their app. The MVP installs into a single test
workspace owned by the developer; per-workspace per-tenant install lands later.
"""
