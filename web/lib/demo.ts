// True in the read-only GitHub Pages snapshot build. NEXT_PUBLIC_ so it's
// readable in both server and client components (inlined at build time).
//
// In demo mode there is NO backend: interactive controls that POST/DELETE or
// fetch live data are disabled and replaced with static/baked content.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
