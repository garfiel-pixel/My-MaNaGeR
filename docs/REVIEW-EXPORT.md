# Review export (owner request)

When the owner asks for "the file to review", a "review copy", or an export for
another model, this is the exact artifact to produce: a folder named
`review-export/` at the repository root, containing a copy of every reviewable
source file, with the paths preserved.

The folder is disposable. It is not referenced by the app, the build, the tests
or the service worker, and deleting it must leave the codebase untouched.

## Contract

- **Copy only.** No source file is edited, moved or deleted while building it.
- **Self-contained.** Preserve repo-relative paths so the reviewer sees the real
  structure (`js/`, `src/`, `tools/`, ...).
- **No README inside the folder.** The owner takes the folder out of the repo;
  nothing extra goes in it.
- **No secrets.** Never include `.dev.vars`, `.wrangler/`, `.cloud-attachments/`
  or anything matching `*.env*`, `*.pem`, `*.key`.
- **Size target:** well under the 500 MB upload cap. The 2026-11-12 snapshot was
  **14 MB, 591 files**. The repo itself is ~1.3 GB, almost all of it `tmp/`,
  `node_modules/`, `dist/`, screenshots and vendor assets.

## Included (exact set, 2026-11-12)

| Path | Contents |
|---|---|
| root `*.html` | Every served page: `app.html`, `project.html`, `calculator.html`, `admin.html`, `index.html`, marketing pages, auth pages, `mymanager-field-guide.html` |
| `worker.js` | Worker entry: CSP hashes, auth session, AI relay, `/api/cloud/*` |
| `src/` | Worker modules: router, auth, cloud API, MCP, billing, webhooks (38 files) |
| `js/` | Front-end modules bundled into app/project (118 files) |
| `css/` | Tokens, components, theme skins, icon sprite `css/mmgr-icons.svg` (40 files) |
| `sw.js` | Service worker |
| `build.js`, `serve.cjs`, `eslint.config.js` | Build, QA server, lint config |
| `demo-data.js`, `projects-data.js` | Seed/demo data |
| root `qa-*.cjs` | Browser QA harnesses |
| `tools/` | QA, verify and audit harnesses plus fixtures; screenshots excluded (253 files) |
| `test/` | `node:test` unit suites (31 files) |
| `migrations/` | Raw SQL D1 migrations (39 files) |
| `mcp/` | MCP server, libs and fixture (9 files) |
| `types/` | Ambient type declarations |
| `.github/workflows/`, `.githooks/` | CI and commit-hook configuration |
| `package.json`, `wrangler.jsonc`, `wrangler.ci.jsonc`, `manifest.webmanifest`, `sitemap.xml`, `tsconfig.typecheck.json` | Runtime and build config |
| `docs/DEVELOPER-GUIDE.md` | Module map, load order, `data-action` convention (the one doc a reviewer needs) |

## Excluded

- **Planning and directive docs:** `EXECUTION-PLAN.md`, `CONTINUATION-DIRECTIVE.md`,
  `AUDIT-DIRECTIVE-*`, `PLANNING-TODO-*`, `REFINEMENT-*`, `MCP-DIRECTIVE-*`,
  root `*.md` and `*.txt`, `web-research/`, `adittion to scope/`,
  `the last update towrads maintainance mode/`, the stale
  `monolith html to reference from all features.html`.
- **Generated output:** `dist/` (bundles and maps are built from `js/` and `css/`),
  `tools/shots/`, `screenshots/`, `dogfood-output/`, `load/results/`.
- **Assets:** `images/`, `vendor/` (three.js, whisper), fonts, audio, video.
- **State and tooling:** `node_modules/`, `.git/`, `.wrangler/`, `tmp/`,
  `_archive/`, `.agents/`, `.codebuddy/`, `.cloud-attachments/`.

## Recipe

Run from the repository root (Git Bash). It copies, never edits.

```bash
DEST="review-export"
mkdir -p "$DEST"

# root pages and scripts (exclude the stale monolith reference)
find . -maxdepth 1 -type f \( -name "*.html" -o -name "*.js" -o -name "*.cjs" \) \
  ! -name "monolith*" -print0 | xargs -0 -r cp --parents -t "$DEST"

# root config plus the developer guide
cp --parents package.json wrangler.jsonc wrangler.ci.jsonc manifest.webmanifest \
  sitemap.xml tsconfig.typecheck.json docs/DEVELOPER-GUIDE.md "$DEST"/

# source trees, complete
for d in js css src test migrations types; do
  find "$d" -type f -print0 | xargs -0 -r cp --parents -t "$DEST"
done

# MCP code only (skip its markdown notes)
find mcp -type f \( -name "*.mjs" -o -name "*.cjs" -o -name "*.json" \) -print0 \
  | xargs -0 -r cp --parents -t "$DEST"

# harnesses and fixtures, no screenshots
find tools -type f \( -name "*.cjs" -o -name "*.js" -o -name "*.mjs" -o -name "*.py" \
  -o -name "*.ps1" -o -name "*.json" -o -name "*.sql" \) \
  -not -path "tools/shots/*" -print0 | xargs -0 -r cp --parents -t "$DEST"

# CI and hooks
find .github -name "*.yml" -print0 | xargs -0 -r cp --parents -t "$DEST"
find .githooks -type f -print0 | xargs -0 -r cp --parents -t "$DEST"
```

## Verify before handing it over

```bash
du -sh review-export && find review-export -type f | wc -l
# no binaries or secrets
find review-export -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.zip" \
  -o -iname "*.woff*" -o -iname "*.env*" -o -name ".dev.vars*" \)
# only the new folder is untracked
git status --porcelain
```

`git status` must show only `?? review-export/` (plus anything the owner already
had untracked). No `npm run verify` is needed because no source changed.

## If the app structure changes

Update this file in the same commit that adds or retires a top-level source
directory, so the next session produces the same reviewable set without
re-deriving it.
