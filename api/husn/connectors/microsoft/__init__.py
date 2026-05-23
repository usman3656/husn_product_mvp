"""Microsoft connector — Outlook/Teams/SharePoint via MS Graph.

Outlook throttling: 10k req/10-min per app+mailbox (~16 rps); recommended 4-10.
Teams: 4 rps per app per team, 1 rps per app per channel/chat.
Publisher verification + M365 Certification required before enterprise rollout.
"""
