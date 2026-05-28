// Shared fetch options for SERVER components.
//
// In a static-export build (GitHub Pages demo, NEXT_OUTPUT_EXPORT=1) every
// server-component fetch must resolve at BUILD time and be cacheable —
// `cache: "no-store"` forces dynamic rendering, which `output: export` rejects
// with a build error. In normal `next dev` we want fresh data on each request.
export const FETCH_INIT: RequestInit =
  process.env.NEXT_OUTPUT_EXPORT === "1"
    ? { cache: "force-cache" }
    : { cache: "no-store" };

// True when building the read-only GitHub Pages demo snapshot.
export const IS_EXPORT = process.env.NEXT_OUTPUT_EXPORT === "1";
