"""Granola connector — meeting notes (AI summaries) via Granola's public API.

Unlike the OAuth connectors (Slack/Jira/Google/Microsoft), Granola uses a
pasted API key (`grn_…`, created in the Granola desktop app under
Settings → Connectors → API keys, Business plan or higher). The key is stored
on the Connection row's access_token, exactly like a bot token.

The public API only returns notes that already have a generated AI summary +
transcript; we ingest each as a `meeting` raw_artifact.
"""
