import { redirect } from "next/navigation";

/** The Resolved folder now lives as a lens inside Explore. Keep this path as a
 *  redirect so old links/bookmarks still land in the right place. */
export default function ResolvedRedirect() {
  redirect("/explore?lens=resolved");
}
