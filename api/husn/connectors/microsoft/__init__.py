"""Microsoft connector — Outlook + OneDrive + SharePoint via Microsoft Graph.

One OAuth app, one access token, one Graph base URL. Mail / Files / Sites
share the same surface. Outlook 10K req / 10-min per app+mailbox (recommended
4-10 rps); per-tenant cap halved Sep 30, 2025. See knowledge.md §7 row 4.
"""
