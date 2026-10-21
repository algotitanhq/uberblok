# Development notes (private infrastructure)

Notes for the team's own build machine and review previews. Nothing here is needed to build
or check the site; the [README](../README.md) covers that.

## Browser checks on the build machine

Chromium needs extra libraries for `scripts/verify.mjs` and Lighthouse on the build machine. Set
this first:

```sh
export LD_LIBRARY_PATH=~/.local/chromium-libs/root/usr/lib/x86_64-linux-gnu
```

The OpenZFS clone used by the permalink checks lives beside the repository, in `../openzfs`, on the build machine.

## Private previews

Previews are private, on the build machine, with its `preview` script, reachable only from the LAN and
the owner's VPN. Nothing goes to a public host before the owner's Go on the first public
release: no production deploy, no preview version, no preview URL (`preview_urls` is off in
`wrangler.jsonc`, and no workflow uploads preview versions).

Each preview builds `origin/<ref>` in a clean copy (the local repository is not touched),
serves `dist/` on a fixed port per name, and is rebuilt every 10 min when the ref has moved.

```sh
preview up uberblok <clone>                                  # main
preview up uberblok-<slice> <clone> <branch>                 # a slice branch under review
preview ls                                                   # name, ref, commit, URL, state
preview down <name>                                          # after the branch is merged
```

URL: `http://<build-machine-ip>:<port>/` (`preview up` and `preview ls` print it). Every slice
branch is served this way while it is in review, then taken down after its merge.

## Switching the deploy on

The Cloudflare keys come from the `algotitanhq` organization (secret `CLOUDFLARE_API_TOKEN`,
an API token with "Workers Scripts: Edit" on the account; variable `CLOUDFLARE_ACCOUNT_ID`),
visible to every repository. Never add repository-level copies: they would override the
organization's. The owner's only step is the Go on the first public release, which sets the
repository variable `PUBLIC_RELEASE=true` on the public repository (the new copy). From then
on, every merge to `main` deploys the site to `<name>.storagebits.workers.dev`, where `<name>`
is the `name` in `wrangler.jsonc` (`uberblok`). The deploy step reads only the token: it asks
Cloudflare for the token's one account, masks its ID, then runs `wrangler`; it never reads the
variable, whose value would show in clear in the log (`DECISIONS.md` D19.1).
