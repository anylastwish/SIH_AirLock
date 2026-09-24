# Repository & deployment

Status: **live** (25 Sep 2026).

| | |
|---|---|
| GitHub | https://github.com/anylastwish/SIH_AirLock — branch `main` (monorepo root = repo root; app in `application/frontend/`) |
| Vercel project | `airlock` in team *anylastwish's projects* (Hobby), id `prj_4eBJgzdE9wyKS7dU5xZB476kVBLq` |
| Production URL | https://airlock-two.vercel.app (also `airlock-anylastwishs-projects.vercel.app`, `airlock-git-main-…` ) |
| Deploy trigger | **Vercel Git integration** — every push to `main` builds and promotes to Production automatically; other branches get preview URLs. No manual CLI deploy needed. |

## Vercel configuration

- Project **Root Directory = `application/frontend`**, framework preset **Vite**, Node 24.x.
- `application/frontend/vercel.json` (committed): `npm run build` (`tsc -b && vite build`) → `dist/`;
  SPA rewrite of everything except `assets/`, `models/`, `fonts/` to `index.html` (so `/input`, `/app`
  and deep links work); `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` on `/models/*`.
- No environment variables / secrets are needed (frontend-only prototype).
- The demo model `public/models/survey-reconstruction.glb` (96.5 MB) is committed and served statically
  from the CDN (under GitHub's 100 MB per-file limit; fine for Git-based builds). Missing files under
  `/models/` return a plain 404 — the optional companion `<model>.metadata.json` probe relies on that.

## Deployment record (25 Sep 2026)

- Commit `b819e05` (model scaling / auto-alignment / clipping / zoom, OBJ loader, fast + extension-less
  PLY) pushed to `main` → production deployment `dpl_FWUWdxUCmzyKyHjujnbXksQPbu3M`, build 32 s, Ready.
- Local checks before push: `npm run build` (tsc + vite) clean; synthetic + integration test suites pass.
- Verified on the production URL: `/`, `/input`, `/app`, deep links → app (SPA rewrite); GLB served in
  full with the cache header (CDN HIT); headless Chrome: `/app` demo model ready (6.3 M points), wheel
  zoom-out to 5.7 km without clipping, tilt 0/150°, heading, object focus (14 m), zoom-in limit, invalid
  camera rejected; real upload UI with the extension-less 496 MB `sarang_dense_cloud` → "Format detected
  from file content (PLY)" → viewer ready (6.13 M of 18.38 M points, auto-levelled).

### Later deployments

| Date | Commit | What | Result |
|---|---|---|---|
| 25 Sep 2026 | `6e4f94f` | Crop tool (floating panel) + central control panel active states, Rotations closed by default | auto-deployed from `main`, Ready (19 s build); production UI suite (30 checks: defaults, blue states, panel positions, real crop drags, tilt/heading, selection, zoom) passed on https://airlock-two.vercel.app |

## Changes made for deployment

- `.gitignore`: all local raw models in `context/Models/` are ignored (not only `*.glb`) — e.g.
  `sarang_dense_cloud` (496 MB, no extension) and the other > 100 MB sources exceed GitHub's file limit.
  They stay local test data; upload them through the UI.
- No application code changed for deployment.

## Notes / gotchas

- Vercel CLI (`npx vercel`) is logged in as `anylastwish` on the dev machine; the local folder is not
  `vercel link`-ed (`.vercel/` is git-ignored) — not needed with the Git integration. For a manual deploy:
  `cd application/frontend && npx vercel link --project airlock && npx vercel --prod`.
- Hobby plan: CLI source uploads are limited to ~100 MB; this project is ≈ 97 MB (mostly the demo GLB).
  Git-based deploys avoid that limit — keep using pushes. A bigger demo model needs Git LFS / external
  storage (e.g. Vercel Blob) instead of `public/`.
- On Windows, don't run `npm ci` while `npm run dev` is running: the dev server locks `esbuild.exe`, and
  `npm ci` fails after deleting `node_modules` (recover with `npm install`).
