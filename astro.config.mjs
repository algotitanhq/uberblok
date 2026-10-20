// @ts-check
import { defineConfig } from "astro/config";

// Static site. Every language carries its prefix (/en/, /fr/, /es/); the root page
// picks one (src/pages/index.astro). Slugs are localized in src/lib/rooms.ts.
export default defineConfig({
  site: "https://uberblok.storagebits.workers.dev",
  output: "static",
  // Keep source whitespace: compression glued words to inline links ("theuberblock").
  compressHTML: false,
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "auto" },
  i18n: {
    locales: ["en", "fr", "es"],
    defaultLocale: "en",
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
  // WebP keeps its alpha lossless by default: the Hall's figure fades out over a
  // wide area, and that alpha alone doubled its weight (DECISIONS.md D16.4).
  image: {
    service: { entrypoint: "astro/assets/services/sharp", config: { webp: { quality: 75, alphaQuality: 60 } } },
  },
  devToolbar: { enabled: false },
});
