/** @type {import('next').NextConfig} */

// Static-export build for GitHub Pages is opt-in via NEXT_OUTPUT_EXPORT=1.
// Normal `next dev` (no env) is completely unaffected — it stays a live SSR app
// talking to the local FastAPI backend.
const isExport = process.env.NEXT_OUTPUT_EXPORT === "1";

// The repo is served at https://<user>.github.io/husn_product_mvp, so all asset
// + route paths must be prefixed. Override with NEXT_BASE_PATH if the repo name
// changes or for a user/org root page.
const basePath = isExport ? process.env.NEXT_BASE_PATH ?? "/husn_product_mvp" : "";

const nextConfig = {
  reactStrictMode: true,
  ...(isExport
    ? {
        output: "export",
        basePath,
        // GitHub Pages has no Next image optimizer.
        images: { unoptimized: true },
        // Pages serves /path/ as /path/index.html — trailing slash keeps links working.
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
