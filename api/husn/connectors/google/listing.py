"""List Gmail labels + Drive folders for the allowlist picker.

Read-only helpers — never persist anything, never trigger backfill. The
allowlist UI calls these to populate the picker; the user's selection
is persisted as project_sources rows by the admin router.
"""

from typing import Any

from husn.connectors.google.client import GoogleClient

GMAIL_LABELS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/labels"
DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"


async def list_labels(gc: GoogleClient) -> list[dict[str, Any]]:
    """Return all Gmail labels (system + user). For the allowlist UI we
    surface user-created labels prominently — system labels are mostly
    plumbing (INBOX, SENT, TRASH) and rarely what husn.io should ingest.
    """
    body = await gc.get(GMAIL_LABELS_URL)
    labels = body.get("labels", []) or []
    # Sort: user-created first (alphabetic), then system labels
    labels.sort(
        key=lambda l: (l.get("type") != "user", (l.get("name") or "").lower())
    )
    return labels


async def list_folder_children(
    gc: GoogleClient, *, parent_id: str = "root"
) -> dict[str, Any]:
    """Return subfolders + a count of direct child files inside `parent_id`.

    For the tree picker we surface ONLY subfolders (so the user navigates
    the hierarchy) — but we also return the count of non-folder files
    immediately inside this folder so the UI can show "📁 X (N files)".

    `parent_id='root'` maps to My Drive's top level.
    """
    folders: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
        params = {
            "q": (
                f"mimeType = 'application/vnd.google-apps.folder' "
                f"and '{parent_id}' in parents and trashed = false"
            ),
            "fields": "nextPageToken, files(id, name, modifiedTime, owners(emailAddress,displayName))",
            "pageSize": 100,
            "orderBy": "name",
        }
        if page_token:
            params["pageToken"] = page_token
        body = await gc.get(DRIVE_FILES_URL, params=params)
        folders.extend(body.get("files", []) or [])
        page_token = body.get("nextPageToken")
        if not page_token:
            break

    file_count_body = await gc.get(
        DRIVE_FILES_URL,
        params={
            "q": (
                f"mimeType != 'application/vnd.google-apps.folder' "
                f"and '{parent_id}' in parents and trashed = false"
            ),
            "fields": "files(id)",
            "pageSize": 1000,
        },
    )
    file_count = len(file_count_body.get("files", []) or [])

    return {"folders": folders, "file_count": file_count}


async def list_root_folders(gc: GoogleClient) -> list[dict[str, Any]]:
    body = await list_folder_children(gc, parent_id="root")
    return body["folders"]


async def get_folder_metadata(gc: GoogleClient, folder_id: str) -> dict[str, Any]:
    """Resolve a folder id to its metadata (name, owners). Used when rendering
    the saved allowlist — we may have a folder_id stored that isn't currently
    in the user's view (e.g. nested deep).
    """
    return await gc.get(
        f"{DRIVE_FILES_URL}/{folder_id}",
        params={"fields": "id, name, modifiedTime, owners(emailAddress,displayName), parents"},
    )
