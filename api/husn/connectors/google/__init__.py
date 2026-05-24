"""Google connector — Gmail + Drive (covers Docs + Sheets).

Per knowledge.md §6 C and docs/google-setup.md:
  * OAuth 2.0 with restricted scopes (gmail.readonly + drive.readonly).
  * Testing-mode bypass for verification + CASA — fine for local MVP, not prod.
  * Strict ingestion allowlist (Gmail labels + Drive folders) per project_sources.
"""
