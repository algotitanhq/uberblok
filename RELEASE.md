# Release: the public repository, one commit

The public repository is a new repository holding a single commit: the tree of the validated
`main`, without the private repository's history (owner's decision at v1, `BUILDLOG.md`, "Three
decisions for the owner"). After the owner's Go on the first public release, the team runs
steps 1 to 3: it checks the tree, builds the one-commit repository, renames the private
repository and creates the public one. That Go is the owner's only step: once the public
repository exists, it sets the repository variable `PUBLIC_RELEASE=true` there (step 4).

## 1. Check the tree

On a clean clone of the private repository, at the `main` the owner validated:

```sh
SHA=<the validated commit of main>    # the full SHA the owner validated
git fetch origin
git merge-base --is-ancestor "$SHA" origin/main && echo "on main"
git switch --detach "$SHA"
gh run list --commit "$SHA" --limit 1 --json conclusion --jq '.[0].conclusion'   # success
```

Every tracked file is published as it is. The list of private names to look for (people,
team roles, machines, private addresses and paths) is kept outside the repository, since a file
listing them would publish them: the team hands it over as a file of patterns, one extended
regular expression per line. These must find nothing (`-I` skips binary files, whose compressed
bytes can match a short pattern by chance):

```sh
git grep -I -n -i -E -f /path/to/private-patterns.txt "$SHA"
git grep -I -n -E '192\.168\.|10\.[0-9]+\.[0-9]+\.[0-9]+|/home/[a-z]' "$SHA"
git grep -I -n -E 'BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|github_pa[t]_|npm_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|xox[abprs]-|sk-[A-Za-z0-9]{20,}|https?://[^/ ]+:[^@/ ]+@' "$SHA"
```

If `gitleaks` is at hand, run it too on the exported tree after step 2, before step 3:
`gitleaks dir "$OUT"`.

The binary files are the images; open each one and check that it carries no metadata:

```sh
git ls-tree -r --name-only "$SHA" | grep -E '\.(png|jpe?g|webp|avif|gif)$'
# docs/screens/uberblok-copy-on-write.png: chunks IHDR, IDAT, IEND only
# src/assets/drive.webp: rendered by scripts/render-drive.mjs, no EXIF or XMP
```

If the public repository is not `algotitanhq/uberblok`, change `REPO_URL` (`src/lib/stack.ts`)
and `SOURCES_URL` (`src/lib/sources.ts`) on `main` first, through a reviewed change.

## 2. Build the one-commit repository

`git archive` exports the tree of the commit and nothing else (no `.git`, no history, no
ignored files):

```sh
OUT=$(mktemp -d)/uberblok
mkdir -p "$OUT"
git archive --format=tar "$SHA" | tar -x -C "$OUT"
cd "$OUT"
git init -q -b main --template=     # no local hooks or templates in the new repository
git add -A
git -c user.name="<author name>" -c user.email="<author noreply email>" \
  commit -q -m "Uberblok, an interactive museum of ZFS"
git log --oneline                      # one commit
git ls-files | wc -l                   # the same count as: git ls-tree -r --name-only "$SHA" | wc -l
```

## 3. Publish (the team, after the owner's Go)

The public repository takes the name `algotitanhq/uberblok`, which `REPO_URL` and
`SOURCES_URL` already use, so the private repository first moves out of the way. Nothing in the
tree depends on the private repository's name.

First, every clone of the private repository, the team's workspaces and any automation
that names the repository, is pointed at the new name, so that no later push can reach the
public repository with the private history; then the rename; then, from the export, a check
that it is the one-commit tree, and the public repository:

```sh
git remote set-url origin https://github.com/algotitanhq/uberblok-private.git   # in every private clone
gh repo rename uberblok-private -R algotitanhq/uberblok --yes                    # history kept, stays private
cd "$OUT"                                                # the export of step 2, not a private clone
test "$(git rev-list --count HEAD)" = 1 && test -z "$(git remote)" && echo "one commit, no remote"
gh repo create algotitanhq/uberblok --public --source . --remote origin --push
gh repo view algotitanhq/uberblok --json visibility,defaultBranchRef   # PUBLIC, main
```

GitHub redirects the old name to the renamed repository only until a repository takes that
name again, which is why the remotes change first. The private repository stays private; its
CI never deploys (`PUBLIC_RELEASE` is not set there). The first push of the public repository
runs CI without deploying: `PUBLIC_RELEASE` is not set there yet.

## 4. Switch the deploy on (the owner)

The Cloudflare keys come from the `algotitanhq` organization: the secret
`CLOUDFLARE_API_TOKEN` and the variable `CLOUDFLARE_ACCOUNT_ID`, visible to every repository.
The deploy reads only the token: it gets the account ID from Cloudflare and masks it (D19.1).
After step 3, the owner's Go sets the repository variable `PUBLIC_RELEASE=true`, in the public
repository only (the new copy), as in `docs/dev.md` ("Switching the deploy on"). Never
add repository-level copies of the keys: they would override the organization's. Then the
team starts the first deploy, a manual run of CI on `main`
(`gh workflow run ci.yml -R algotitanhq/uberblok --ref main`); after it, every push to `main`
deploys the site to `<name>.storagebits.workers.dev` (`name` in `wrangler.jsonc`: `uberblok`).
