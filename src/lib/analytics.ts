// Cloudflare Web Analytics, in the production build only (DECISIONS.md D18.2).
// The site token is public (it ships in every page), not a secret.
export const CF_WEB_ANALYTICS_TOKEN: string = "4263dc6b78d14ab1af349081454753cf";

// The rule: the same switch as the public deploy, and a non-empty token (an empty
// token emits no beacon). Pure, so scripts/test/analytics.test.mjs covers it.
export function analyticsOn(release: string | undefined, token: string): boolean {
  return release === "true" && token !== "";
}

// CI sets PUBLIC_RELEASE=true for the build only when the Deploy step will ship it
// (ci.yml, the Build step copies Deploy's condition). Forge previews, branch builds and
// `npm run build` on a laptop never set it. `import.meta.env` is absent under plain Node;
// in a build Vite inlines it, and the Build step fails a release build without the beacon.
const env: Record<string, string | undefined> = import.meta.env ?? {};
export const ANALYTICS_ON = analyticsOn(env.PUBLIC_RELEASE, CF_WEB_ANALYTICS_TOKEN);
