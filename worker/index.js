// The only Worker code (DECISIONS.md D20.1): `/` answers a 302 to /en/, /fr/ or /es/, so the
// browser keeps the visitor's Referer across the redirect and Web Analytics sees where the
// visit came from. Every other path is static assets (wrangler.jsonc `run_worker_first`).
import { pickLang } from "./root-lang.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/") return env.ASSETS.fetch(request);
    const lang = pickLang(request.headers.get("Cookie"), request.headers.get("Accept-Language"));
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/${lang}/${url.search}`,
        "Cache-Control": "private, no-store",
        Vary: "Accept-Language, Cookie",
        // The security headers of public/_headers that apply to a body-less redirect.
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    });
  },
};
