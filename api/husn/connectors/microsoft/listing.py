"""List Outlook mail folders + OneDrive folders for the allowlist picker.

Read-only helpers — never persist anything, never trigger backfill.
"""

from typing import Any

from husn.connectors.microsoft.client import MicrosoftClient


async def list_mail_folders(mc: MicrosoftClient) -> list[dict[str, Any]]:
    """Return top-level mail folders + the few default child folders that
    matter (Junk, Drafts, Archive). Graph returns child folders via
    `/childFolders` per folder; we cap depth to 1 — power users have hundreds
    of nested categorisation folders that we don't want to list.
    """
    out: list[dict[str, Any]] = []

    # Top-level folders
    body = await mc.get(
        "/me/mailFolders",
        params={"$select": "id,displayName,totalItemCount,unreadItemCount,childFolderCount", "$top": "50"},
    )
    out.extend(body.get("value", []) or [])
    return out


def _is_folder_item(item: dict[str, Any]) -> bool:
    """Treat both native folders AND remoteItem-mounted folders as folders.

    A folder shared into your OneDrive (Personal Vault, an org folder you
    'Added to My files', etc.) arrives as a `remoteItem` — its folder marker
    is nested at `remoteItem.folder`, not at the top level. Without this
    check the picker silently hides those shared / mounted folders.
    """
    if item.get("folder"):
        return True
    remote = item.get("remoteItem") or {}
    return bool(remote.get("folder"))


def _annotate_remote(item: dict[str, Any]) -> dict[str, Any]:
    """If `item` is a remoteItem-folder, copy the remote drive id + item id
    to the top level so downstream code can pick the right Graph URL
    (`/drives/{drive}/items/{id}`) without having to dig into remoteItem.
    """
    remote = item.get("remoteItem") or {}
    if remote.get("folder"):
        parent = remote.get("parentReference") or {}
        item["_remote_drive_id"] = parent.get("driveId")
        item["_remote_item_id"] = remote.get("id")
    return item


def _scope_to_children_path(scope: str | None) -> str:
    """Translate a stored scope string to a Graph children-listing path.
      - None / ""              → user's drive root
      - "remote:<drive>:<id>"  → remote drive item (shared / mounted org folder)
      - "<id>" (plain id)      → folder in the user's own drive
    """
    if not scope:
        return "/me/drive/root/children"
    if scope.startswith("remote:"):
        _, drive_id, item_id = scope.split(":", 2)
        return f"/drives/{drive_id}/items/{item_id}/children"
    return f"/me/drive/items/{scope}/children"


async def list_onedrive_folders(
    mc: MicrosoftClient, *, parent_id: str | None = None
) -> dict[str, Any]:
    """Return subfolders + a count of non-folder items inside `parent_id`.

    `parent_id` accepts the same scope encoding stored in the allowlist so
    the picker can expand into shared folders (Project Atlas-style) by clicking
    them, not just plain drive folders.
    """
    path = _scope_to_children_path(parent_id)
    folders: list[dict[str, Any]] = []
    file_count = 0
    next_url: str | None = path
    while next_url:
        body = await mc.get(
            next_url,
            params=(
                {
                    "$select": "id,name,folder,file,size,lastModifiedDateTime,webUrl,createdBy,remoteItem,parentReference",
                    "$top": "200",
                }
                if next_url == path
                else None
            ),
        )
        for item in body.get("value", []) or []:
            if _is_folder_item(item):
                folders.append(_annotate_remote(item))
            elif item.get("file"):
                file_count += 1
        next_url = body.get("@odata.nextLink")
    return {"folders": folders, "file_count": file_count}


async def get_onedrive_folder_metadata(
    mc: MicrosoftClient, folder_id: str
) -> dict[str, Any]:
    """Resolve a folder id back to metadata (name, parent) for the picker UI.
    Accepts the same scope encoding as `list_onedrive_folders` so the picker
    can resolve names of already-selected shared folders too.
    """
    if folder_id.startswith("remote:"):
        _, drive_id, item_id = folder_id.split(":", 2)
        return await mc.get(
            f"/drives/{drive_id}/items/{item_id}",
            params={"$select": "id,name,parentReference,lastModifiedDateTime,webUrl"},
        )
    return await mc.get(
        f"/me/drive/items/{folder_id}",
        params={"$select": "id,name,parentReference,lastModifiedDateTime,webUrl"},
    )
