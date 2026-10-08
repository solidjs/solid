# HackerNews twins — client bundle size on `@solidjs/router@2.0.0-next.37` (2026-10-08)

Branch `audit/hn-twins-size` off `next` @ `8d23a5a13`. **Nothing here changes
an engine or an example**: this document and nothing else. It measures the two
HackerNews examples — `examples/hackernews-spa` (SSR + hydration, the
comparison baseline) and `examples/hackernews` (server components over frame
streams) — the way a Vite application ships them: each twin's own
`vite build`, production, minified, against this checkout's freshly built
`solid-js` / `@solidjs/web` / `@solidjs/signals`, with `@solidjs/router`
pinned to the published `2.0.0-next.37` (and once to `2.0.0-next.35`, so the
router's own delta shows). Companions: the size harness's router re-base on
the same head (`scripts/size`, PR #3909 — the `page: base + router` /
`page: live + router` scenarios on next.37) and the server-components size
audits under `documentation/plans/`.

Units are bytes; KB is decimal (1 KB = 1000 B) as in `scripts/size`. Brotli
is quality 11 (`scripts/size/bundle.mjs`'s `brotli`). "Minified" is the
file as Vite emits it (Vite 8.1.5, its default `oxc` minifier).

_Status: complete (2026-10-08). Every number below was measured; none is an estimate._

---

## 0. The numbers

Eager = the entry chunk plus every chunk it reaches through **static**
imports — `bundle.mjs`'s rule, read here from `dist/client/.vite/manifest.json`
(`imports` are static edges, `dynamicImports` are lazy). Brotli is given two
ways: **per-file** (each eager chunk compressed on its own and summed — what
the browser downloads, and how the harness counts a split eager graph) and
**one-stream** (the eager chunks concatenated and compressed once — the
lower bound a single-chunk build would reach).

| Build (router) | Eager files | Minified | Brotli per-file | Brotli one-stream |
| --- | ---: | ---: | ---: | ---: |
| **SPA twin, next.37** | 2 | **101,891** | **34,245 (34.24 KB)** | **33,525 (33.52 KB)** |
| SPA twin, next.35 | 3 | 109,974 | 37,648 (37.65 KB) | 36,235 (36.23 KB) |
| **SC twin, next.37, `dynamic()` (as committed)** | 3 | **138,279** | **46,460 (46.46 KB)** | **44,664 (44.66 KB)** |
| **SC twin, next.37, `dynamicComponent`** | 3 | **130,471** | **44,098 (44.10 KB)** | **42,304 (42.30 KB)** |
| SC twin, next.35, `dynamic()` | 5 | 146,253 | 50,742 (50.74 KB) | 47,278 (47.28 KB) |
| SC twin, next.35, `dynamicComponent` | 5 | 138,452 | 48,374 (48.37 KB) | 44,924 (44.92 KB) |

Beside the maintainer's reference points: Solid 1.x HN SPA ≈ 26 KB br; his
estimate for the Solid 2 SPA ≈ 32 KB; the SC twin's harness figures on
next.35 ≈ 47.8 KB (`dynamic()`) / ≈ 45.4 KB (`dynamicComponent`); #3909's
`page: base + router` on next.37, 41.2 KB. Read against those:

- The **Solid 2 SPA on next.37 is 33.5 KB br as one stream, 34.2 KB as the
  two files Vite emits** — 1.5–2.2 KB over the 32 KB estimate, 7.5–8.2 KB
  over the 1.x figure. On next.35 it was 36.2 / 37.6 KB; the router release
  alone took **2.7 KB (one-stream) / 3.4 KB (per-file)** off it (§4).
- The SC twin's Vite one-stream numbers on next.35 — 47.28 / 44.92 KB —
  reproduce the harness's 47.8 / 45.4 within half a KB (different bundler,
  same graph). On next.37 the SC twin is **44.66 KB (`dynamic()`) /
  42.30 KB (`dynamicComponent`) one-stream, 46.46 / 44.10 KB per-file.**
- #3909's `page: base + router` (41.2 KB, one chunk) is a **server-components**
  page — `installServerComponents`, one `dynamicComponent` over a
  server-function reference, `Show`/`For`/`Loading`/`Errored`, `createRouter`
  with two routes, `preload`, a `lazy` route, `useNavigate` — so its relative
  here is the SC twin, not the SPA. The SC twin with `dynamicComponent` lands
  **+1.1 KB** over it one-stream (42.3; +2.9 KB per-file, across three files
  where the harness page is one), with `dynamic()` +3.4 KB (44.7). The SPA
  twin sits **7.7 KB under** it (33.5): the frames client the harness page
  carries and the SPA does not.

## 1. The twins

Both live under `examples/` and are workspace packages (`pnpm-workspace.yaml`
lists `examples/*`), so their `solid-js` and `@solidjs/web` are the
`workspace:*` links — `examples/<twin>/node_modules/solid-js →
../../../packages/solid`, `@solidjs/web → ../../../../packages/web` — and
`@solidjs/signals` arrives through `solid-js`'s own dependency, which the
workspace `overrides` also route to the local package (the source maps
confirm it: every signals byte maps to `packages/signals/dist/prod/…`). Both `package.json`s pin **`@solidjs/router`
`2.0.0-next.29`** and **`@solidjs/vite-plugin` `3.0.0-next.35`**, with
`vite ^8.0.0` (8.1.5 installed). Each `vite.config.ts` is
`solid({ start: {}, ssr: true, serverFunctions: … })` — turnkey SSR: the
plugin generates the client entry (`virtual:solid-ssr-entry-client.tsx`), the
document, the error boundary and the server handler; `src/app.tsx` is the
app root. The whole wiring difference is one flag: the SC twin's
`serverFunctions: { components: true }`. Build script: `vite build` (client
then SSR environment); `server.js` is the production server (not part of
the client bundle).

The SC twin **mounts with `dynamic()`**, not `dynamicComponent` — four sites,
all `import { dynamic } from "@solidjs/web"`: `Nav` in `src/app.tsx`
(`dynamic(() => navView())`) and the three routes
(`src/routes/{stories,story,user}.tsx`, `dynamic(() => getX(...))`). The
`dynamicComponent` builds in §5 are a temporary edit of those four files
(the import and the four calls), reverted after the build; the committed
source is unchanged.

The router resolves through its **`solid` export condition** —
`@solidjs/vite-plugin` puts `solid` ahead of Vite's client conditions — so
what gets bundled is `dist/index.jsx` plus the router's per-module output,
the two JSX modules (`routers/factory.jsx`, `routers/components.jsx`)
compiled by this checkout's `@solidjs/compiler` through the plugin, like the
app's own `.tsx`. That is the same resolution the harness switched to in
#3909; `data/events`' `import("./serverForms.js")` is therefore the lazy
`serverForms-*.js` chunk here, not an eager edge.

## 2. Method

1. Fresh worktree of `origin/next` @ `8d23a5a13`; `pnpm install`; the native
   compiler built (`pnpm --filter @solidjs/compiler run build` →
   `packages/compiler/compiler.node`, 02:23:17); every package rebuilt with
   `turbo run build --filter='./packages/*' --filter='!@solidjs/compiler'
   --force` (exit 0, 02:23:49). The examples' `dist/` were deleted before
   every build.
2. Router pin: a **temporary** `overrides: { '@solidjs/router': 2.0.0-next.37 }`
   in `pnpm-workspace.yaml` (plus `'@solidjs/router'` in
   `minimumReleaseAgeExclude`, next.37 having been published at
   06:37 UTC the same day) and `pnpm install --no-frozen-lockfile`; then the
   same with `2.0.0-next.35`. Verified each time through
   `examples/<twin>/node_modules/@solidjs/router → …/.pnpm/@solidjs+router@2.0.0-next.3N_@solidjs+web@packages+web_solid-js@packages+solid/…`
   (the peer suffix is the proof the router's own `solid-js` / `@solidjs/web`
   are the workspace packages). Both files were reverted (`git checkout`) and
   `pnpm install --frozen-lockfile` re-run at the end; the committed lockfile
   is untouched.
3. Build: `vite build --sourcemap hidden` in each twin. `hidden` writes the
   `.map` files without appending `sourceMappingURL` comments; a plain
   `vite build` was run first and every emitted JS file was **byte-identical**
   in size, so the maps cost nothing in the numbers. Builds were repeated
   after the pin round-trip and reproduced the same hashes and sizes.
4. Measure (scratch script outside the repo): per JS file, minified = file
   length, brotli = `zlib.brotliCompressSync(..., { BROTLI_PARAM_QUALITY: 11 })`
   length; eager/lazy from the manifest as in §0; one-stream = brotli of the
   eager files concatenated in closure order. Every `.js` under
   `dist/client/assets` is listed; the one CSS file is listed but never
   counted (the question is the JS bundle).
5. Attribution: each eager chunk's source map decoded (VLQ), every generated
   byte charged to the source of the mapping segment covering it (bytes before
   the first segment of a line, and lines with no segment, are
   `(unmapped)` — Rollup's import/export glue and Vite's inlined preload
   helper, which carries no mapping). The per-source sums equal the file
   sizes exactly, so **minified attribution is exact**. `≈ br` apportions
   each file's brotli by minified share: a package's `≈ br` is approximate,
   and because the same module lands in differently compressing chunks
   across builds, **by-package br deltas across builds are not byte-exact;
   read composition in the minified column and totals in the br columns.**
   Packages: `packages/signals/` → `@solidjs/signals`; `packages/solid/` →
   `solid-js`; `packages/web/dist/` → `@solidjs/web`; `packages/web/frames/`
   → frames; `packages/web/server-functions/` → server-functions; the
   router's store path → `@solidjs/router`; `examples/<twin>/src/` and the
   plugin's `virtual:solid-ssr-*` modules → app.

## 3. SPA twin on next.37

Entry `virtual_solid-ssr-entry-client-4wjqmeor.js`. The eager graph is
**two files**: Rollup hoists the runtime the entry shares with the lazy
server-form chunks into a chunk the entry imports statically (named after
Vite's preload helper, its first module). Lazy: the router's server-form
fallback, the `@solidjs/web/server-functions` **server** half (reached only
through `data/action.js`'s `import("@solidjs/web/server-functions/server")`,
the flash-cookie decoder), the seroval codec (`web-*.js` is seroval +
seroval-plugins, named after the plugins' `web-*.js`), and the two
serialization entry points.

| Chunk | Kind | Minified | Brotli |
| --- | --- | ---: | ---: |
| `virtual_solid-ssr-entry-client-4wjqmeor.js` | eager — entry | 57,601 | 18,804 |
| `preload-helper-Dz-qWu5u.js` | eager — static import of the entry | 44,290 | 15,441 |
| **Eager total** | | **101,891** | **34,245 per-file · 33,525 one-stream** |
| `serverForms-DguwHPHp.js` | lazy — router `data/serverForms` | 5,686 | 2,377 |
| `server-KnHLMSYJ.js` | lazy — `web/server-functions/dist/server.js` | 56,277 | 17,262 |
| `web-DNZ0oF7u.js` | lazy — seroval + seroval-plugins | 45,484 | 11,584 |
| `serialization-rjs4QUOb.js` | lazy — `web/serialization/dist/serialization.js` | 4,420 | 1,763 |
| `decode-CGx94lgB.js` | lazy — `web/serialization/dist/decode.js` | 3,075 | 1,289 |
| Lazy total | | 114,942 | 34,275 |
| `virtual_solid-ssr-entry-client-XvQqrDQ_.css` | css (not counted) | 3,539 | 953 |

Eager composition (entry chunk: the router's `routers/*`, the app's
components and routes, the generated document/error-boundary/entry; hoisted
chunk: signals' core, `solid.js`, `internal.js`, `web.js`,
`server-functions/client.js`, the router's `routing`, `utils`, `claims`,
`data/events`, `data/query`, `paths`, `serverRouteShared`):

| Package | Minified | ≈ Brotli | Share (min) |
| --- | ---: | ---: | ---: |
| `@solidjs/signals` | 30,487 | 10,629 | 29.9 % |
| `@solidjs/router` | 23,109 | 7,544 | 22.7 % |
| `solid-js` | 13,803 | 4,812 | 13.5 % |
| `@solidjs/web` | 13,375 | 4,366 | 13.1 % |
| `@solidjs/web/server-functions` | 13,292 | 4,339 | 13.0 % |
| app | 7,418 | 2,422 | 7.3 % |
| (unmapped) | 407 | 133 | 0.4 % |
| **Total** | **101,891** | **34,245** | |

`@solidjs/web/frames` is absent, as it should be: the SPA twin never imports
the frames runtime. `@solidjs/web/server-functions` (13.3 KB minified, the
`createServerReference` client: fetch, response decoding, flight data,
redirect handling) is eager because `src/lib/hn.ts` is a `"use server"`
module and the three `query`-wrapped calls are the app's data layer.

Per-module (eager, minified; ≥ 100 B):

| Module | Minified |
| --- | ---: |
| `web:web.js` | 13,375 |
| `web/server-functions:client.js` | 13,292 |
| `solid:solid.js` | 12,288 |
| `signals:prod/core/core.js` | 7,321 |
| `router:routing.js` | 6,465 |
| `signals:prod/core/scheduler.js` | 5,267 |
| `signals:prod/map.js` | 4,036 |
| `signals:prod/core/async.js` | 3,951 |
| `router:data/query.js` | 3,490 |
| `signals:prod/boundaries.js` | 3,017 |
| `router:utils.js` | 3,006 |
| `router:data/events.js` | 2,484 |
| `router:routers/factory.jsx` | 1,791 |
| `signals:prod/core/owner.js` | 1,570 |
| `solid:internal.js` | 1,515 |
| `router:claims.js` | 1,439 |
| `router:routers/scrollRestoration.js` | 1,383 |
| `app:src/components/story.tsx` | 1,343 |
| `app:src/routes/story.tsx` | 1,204 |
| `router:routers/history.js` | 1,148 |
| `signals:prod/core/effect.js` | 1,060 |
| `signals:prod/core/heap.js` | 1,040 |
| `router:routers/components.jsx` | 961 |
| `app:src/routes/stories.tsx` | 902 |
| `app:src/routes/user.tsx` | 864 |
| `app:src/components/comment.tsx` | 860 |
| `signals:prod/core/graph.js` | 839 |
| `signals:prod/flatten.js` | 670 |
| `signals:prod/core/error-hooks.js` | 513 |
| `router:paths.js` | 508 |
| `signals:prod/core/error.js` | 436 |
| `router:serverRouteShared.js` | 434 |
| `app:src/lib/api.ts` | 433 |
| `app:src/components/toggle.tsx` | 422 |
| `signals:prod/signals.js` | 412 |
| `(unmapped)` | 407 |
| `app:src/components/nav.tsx` | 407 |
| `app:src/App.tsx` | 315 |
| `app:virtual:solid-ssr-entry-client.tsx` | 285 |
| `signals:prod/core/context.js` | 210 |
| `app:virtual:solid-ssr-error-boundary.tsx` | 193 |
| `app:virtual:solid-ssr-document.tsx` | 190 |
| `signals:prod/core/constants.js` | 128 |

## 4. SPA twin: next.35 → next.37

On next.35 the eager graph was **three** files — the entry (12,862 / 4,277),
the hoisted runtime (`preload-helper-CXzPkT7k.js`, 44,919 / 15,634) and a
second hoisted chunk (`query-D7POjp9g.js`, 52,193 / 17,737: signals'
`lanes.js` + `verdict.js`, `web.js`, `server-functions/client.js` and the
router's `routing`/`utils`/`claims`/`events`/`query`). The lazy set is the
same five chunks within a few bytes (`serverForms` 5,667 / 2,375).

| | next.35 | next.37 | Δ |
| --- | ---: | ---: | ---: |
| Eager files | 3 | 2 | −1 |
| Eager minified | 109,974 | 101,891 | **−8,083** |
| Eager brotli, per-file | 37,648 | 34,245 | **−3,403** |
| Eager brotli, one-stream | 36,235 | 33,525 | **−2,710** |

By package (minified / ≈ br):

| Package | next.35 | next.37 | Δ min | Δ ≈ br |
| --- | ---: | ---: | ---: | ---: |
| `@solidjs/signals` | 37,311 / 12,931 | 30,487 / 10,629 | **−6,824** | −2,302 |
| `@solidjs/router` | 23,268 / 7,870 | 23,109 / 7,544 | −159 | −326 |
| `solid-js` | 14,254 / 4,961 | 13,803 / 4,812 | −451 | −149 |
| `@solidjs/web` | 13,287 / 4,515 | 13,375 / 4,366 | +88 | −149 |
| `@solidjs/web/server-functions` | 13,305 / 4,522 | 13,292 / 4,339 | −13 | −183 |
| app | 7,222 / 2,402 | 7,418 / 2,422 | +196 | +20 |
| (unmapped) | 1,327 / 447 | 407 / 133 | −920 | −314 |

What moved (modules, minified): `signals:prod/core/lanes.js` 4,738 → **0**
and `signals:prod/core/verdict.js` 1,908 → **0** — the verdict machinery
leaves the page entirely, which is solid-router#660's point: the router's
navigation core no longer reads `isPending` / `latest`, and this app reads
neither on its own (its `Loading` boundaries are the only pending state it
renders). The router's own bytes: `routing.js` 6,623 → 6,465,
`routers/factory.jsx` 2,075 → 1,791, `data/query.js` 3,664 → 3,490,
`routers/scrollRestoration.js` 925 → 1,383 (the native-restore / `onSettled`
settle path), `data/events.js` 2,452 → 2,484, `claims.js` 1,488 → 1,439 —
net −159. `solid:internal.js` 1,889 → 1,515 and the unmapped glue −920 are
the chunk shape: three eager chunks became two, so one set of
import/export lists and one brotli stream fewer (per-file br fell 693 B
more than one-stream did).

`data-pending` on plain anchors is opt-in on next.37
(`createRouter({ routes, links: pendingLinks })`); neither twin opts in, so
the next.37 builds measure the default and the SPA's anchors no longer carry
`data-pending` during navigation. That is the "pay-for-use" trade the −2.7 /
−3.4 KB buys.

## 5. SC twin on next.37

Entry `virtual_solid-ssr-entry-client-Byj-VgUv.js`. The eager graph is
**three files**: the entry, the hoisted runtime (`preload-helper-*.js`, as
on the SPA) and `client-*.js` — the frames client (`web/frames:client.js`)
with the `web.js` / `server-functions/client.js` / store modules it shares
with the lazy tier chunks. Lazy: the five frames tiers (`trace`, `bind`,
`regions`, `wire`, `assets`), the router's server-form fallback, the
server-functions server half, the codec, the serialization entries.

### 5.1 `dynamic()` — as committed

| Chunk | Kind | Minified | Brotli |
| --- | --- | ---: | ---: |
| `virtual_solid-ssr-entry-client-Byj-VgUv.js` | eager — entry | 25,419 | 9,180 |
| `preload-helper-cZHeylHR.js` | eager — static import | 43,416 | 14,867 |
| `client-SZQxGdxD.js` | eager — static import (frames client) | 69,444 | 22,413 |
| **Eager total** | | **138,279** | **46,460 per-file · 44,664 one-stream** |
| `trace-DNpIRReI.js` | lazy — frames `trace` tier | 25,479 | 8,281 |
| `bind-C5Hoo1vy.js` | lazy — frames `bind` tier | 4,712 | 1,850 |
| `regions-B60JWbm_.js` | lazy — frames `regions` tier | 1,823 | 792 |
| `wire-CrG7Z_fX.js` | lazy — frames `wire` tier | 1,840 | 924 |
| `assets-DdVVLy08.js` | lazy — frames `assets` tier | 2,006 | 758 |
| `serverForms-Ch8BOntu.js` | lazy — router `data/serverForms` | 5,733 | 2,396 |
| `server-YITnWNqO.js` | lazy — `web/server-functions/dist/server.js` | 56,277 | 17,269 |
| `web-DNZ0oF7u.js` | lazy — seroval + seroval-plugins | 45,484 | 11,584 |
| `serialization-rjs4QUOb.js` | lazy — serialization | 4,420 | 1,763 |
| `decode-CGx94lgB.js` | lazy — decode | 3,075 | 1,289 |
| Lazy total | | 150,849 | 46,906 |
| `virtual_solid-ssr-entry-client-XvQqrDQ_.css` | css (not counted) | 3,539 | 953 |

| Package | Minified | ≈ Brotli | Share (min) |
| --- | ---: | ---: | ---: |
| `@solidjs/signals` | 30,936 | 10,509 | 22.4 % |
| `@solidjs/web/frames` | 28,411 | 9,170 | 20.5 % |
| `@solidjs/router` | 22,824 | 8,243 | 16.5 % |
| `@solidjs/web` | 21,767 | 7,025 | 15.7 % |
| `solid-js` | 16,786 | 5,748 | 12.1 % |
| `@solidjs/web/server-functions` | 14,590 | 4,709 | 10.6 % |
| app | 1,903 | 687 | 1.4 % |
| (unmapped) | 1,062 | 369 | 0.8 % |
| **Total** | **138,279** | **46,460** | |

### 5.2 `dynamicComponent` — temporary edit of the four mount sites

| Chunk | Kind | Minified | Brotli |
| --- | --- | ---: | ---: |
| `virtual_solid-ssr-entry-client-B5gtIXtk.js` | eager — entry | 25,419 | 9,179 |
| `preload-helper-cZHeylHR.js` | eager — static import | 43,416 | 14,867 |
| `client-Dyt9NQ8a.js` | eager — static import (frames client) | 61,636 | 20,052 |
| **Eager total** | | **130,471** | **44,098 per-file · 42,304 one-stream** |
| `trace-D4zHHYsN.js` | lazy — frames `trace` tier | 26,036 | 8,432 |
| `bind-DWVmYNv-.js` | lazy — frames `bind` tier | 4,712 | 1,849 |
| `regions-BfYmQHGv.js` | lazy — frames `regions` tier | 1,823 | 794 |
| `wire-DWDDwG1R.js` | lazy — frames `wire` tier | 1,840 | 921 |
| `assets-DdVVLy08.js` | lazy — frames `assets` tier | 2,006 | 758 |
| `serverForms-DAgh9V1A.js` | lazy — router `data/serverForms` | 5,733 | 2,392 |
| `server-YITnWNqO.js` | lazy — `web/server-functions/dist/server.js` | 56,277 | 17,269 |
| `web-DNZ0oF7u.js` | lazy — seroval + seroval-plugins | 45,484 | 11,584 |
| `serialization-rjs4QUOb.js` | lazy — serialization | 4,420 | 1,763 |
| `decode-CGx94lgB.js` | lazy — decode | 3,075 | 1,289 |
| Lazy total | | 151,406 | 47,051 |

| Package | Minified | ≈ Brotli | Share (min) |
| --- | ---: | ---: | ---: |
| `@solidjs/web/frames` | 28,313 | 9,211 | 21.7 % |
| `@solidjs/signals` | 26,630 | 9,119 | 20.4 % |
| `@solidjs/router` | 22,824 | 8,242 | 17.5 % |
| `@solidjs/web` | 18,373 | 5,977 | 14.1 % |
| `solid-js` | 16,786 | 5,748 | 12.9 % |
| `@solidjs/web/server-functions` | 14,580 | 4,743 | 11.2 % |
| app | 1,903 | 687 | 1.5 % |
| (unmapped) | 1,062 | 370 | 0.8 % |
| **Total** | **130,471** | **44,098** | |

### 5.3 `dynamic()` → `dynamicComponent`

| | `dynamic()` | `dynamicComponent` | Δ |
| --- | ---: | ---: | ---: |
| Eager minified | 138,279 | 130,471 | **−7,808** |
| Eager brotli, per-file | 46,460 | 44,098 | **−2,362** |
| Eager brotli, one-stream | 44,664 | 42,304 | **−2,360** |

The whole delta is in `client-*.js` (69,444 → 61,636); the entry and the
hoisted runtime are byte-identical. Modules: `web:web.js` 21,767 → 18,373
(**−3,394**: `dynamic`'s tag arm — `spread` (the bulk), `staticElement`,
`createElement`, `readShallow`, the `SVGElements` table — gone; `dynamicComponent`
itself is +3 lines over `dynamic`), `signals:prod/store/utils.js` 3,565 →
**0** and `signals:prod/store/types.js` 741 → **0** (**−4,306**: the
prop-collection tables `spread` reads through — `sourceEnumerableKeys`,
`mergeLookup`, `leafKeys`, `collectTable`, `omitTable`, … — retained only by
the tag arm), `web/frames:client.js` 28,411 → 28,313 (−98). The `trace` tier
grows 557 B (25,479 → 26,036) because what it shared with the eager graph is
no longer there to share. Per-file and one-stream agree here (−2,362 /
−2,360): the eager graph keeps its three-file shape either way.

Per-module (eager, minified; ≥ 100 B) for the `dynamicComponent` build —
the `dynamic()` build is this list plus `signals:prod/store/utils.js` 3,565,
`signals:prod/store/types.js` 741, and `web:web.js` at 21,767,
`web/frames:client.js` at 28,411:

| Module | Minified |
| --- | ---: |
| `web/frames:client.js` | 28,313 |
| `web:web.js` | 18,373 |
| `solid:solid.js` | 14,915 |
| `web/server-functions:client.js` | 14,580 |
| `signals:prod/core/core.js` | 7,460 |
| `router:routing.js` | 6,435 |
| `signals:prod/core/scheduler.js` | 5,258 |
| `signals:prod/core/async.js` | 3,961 |
| `router:data/query.js` | 3,263 |
| `signals:prod/boundaries.js` | 3,022 |
| `router:utils.js` | 2,997 |
| `router:data/events.js` | 2,482 |
| `solid:internal.js` | 1,871 |
| `router:routers/factory.jsx` | 1,787 |
| `signals:prod/core/owner.js` | 1,573 |
| `router:claims.js` | 1,435 |
| `router:routers/scrollRestoration.js` | 1,382 |
| `router:routers/history.js` | 1,144 |
| `(unmapped)` | 1,062 |
| `signals:prod/core/effect.js` | 1,060 |
| `signals:prod/core/heap.js` | 1,038 |
| `router:routers/components.jsx` | 961 |
| `signals:prod/core/graph.js` | 858 |
| `signals:prod/flatten.js` | 670 |
| `signals:prod/core/error-hooks.js` | 513 |
| `router:paths.js` | 506 |
| `signals:prod/core/error.js` | 436 |
| `router:serverRouteShared.js` | 432 |
| `signals:prod/signals.js` | 415 |
| `app:src/App.tsx` | 391 |
| `app:src/components/toggle.tsx` | 321 |
| `app:src/routes/stories.tsx` | 259 |
| `app:virtual:solid-ssr-entry-client.tsx` | 226 |
| `signals:prod/core/context.js` | 210 |
| `app:virtual:solid-ssr-error-boundary.tsx` | 201 |
| `app:virtual:solid-ssr-document.tsx` | 188 |
| `signals:prod/core/constants.js` | 156 |
| `app:src/routes/story.tsx` | 134 |
| `app:src/routes/user.tsx` | 131 |

### 5.4 SC twin on next.35 (context check)

Measured once, both ways, to place the harness's reference figures
(≈ 47.8 / ≈ 45.4 KB) on the same footing. On next.35 the SC eager graph is
**five** files (entry 7,235; hoisted runtime 43,899; a `query-*.js` chunk
25,386 with signals' lanes/verdict, `web.js` and the router core; the frames
client 41,278 / 33,479; a second `client-*.js` 28,455 with the store
modules), which is why per-file brotli sits 3.4 KB above one-stream there.

| SC twin | Eager files | Minified | Brotli per-file | Brotli one-stream |
| --- | ---: | ---: | ---: | ---: |
| next.35 `dynamic()` | 5 | 146,253 | 50,742 | 47,278 |
| next.37 `dynamic()` | 3 | 138,279 | 46,460 | 44,664 |
| Δ | −2 | **−7,974** | **−4,282** | **−2,614** |
| next.35 `dynamicComponent` | 5 | 138,452 | 48,374 | 44,924 |
| next.37 `dynamicComponent` | 3 | 130,471 | 44,098 | 42,304 |
| Δ | −2 | **−7,981** | **−4,276** | **−2,620** |

The router release moves the SC twin by the same mechanism as the SPA
(signals −6,769 / −6,780 minified: lanes and verdict leave; router +50;
unmapped −1,146 as five chunks become three) and by nearly the same amount
one-stream (−2.6 KB vs the SPA's −2.7 KB). The one-stream next.35 figures
(47.28 / 44.92 KB) land within 0.5 KB of the harness's 47.8 / 45.4.

## 6. SPA vs SC on this release

| next.37 | SPA | SC `dynamic()` | Δ | SC `dynamicComponent` | Δ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Eager minified | 101,891 | 138,279 | **+36,388** | 130,471 | **+28,580** |
| Eager brotli, per-file | 34,245 | 46,460 | **+12,215** | 44,098 | **+9,853** |
| Eager brotli, one-stream | 33,525 | 44,664 | **+11,139** | 42,304 | **+8,779** |
| Eager files | 2 | 3 | +1 | 3 | +1 |

What the gap is made of (minified, SPA → SC `dynamicComponent`; the
`dynamic()` column adds the tag arm's +3,394 in `@solidjs/web` and +4,306 in
signals' store modules on top):

| Package | SPA | SC (`dynamicComponent`) | Δ min | What |
| --- | ---: | ---: | ---: | --- |
| `@solidjs/web/frames` | 0 | 28,313 | **+28,313** | the frames client (`frames:client.js`), eager in full; the tiers are lazy |
| `@solidjs/web` | 13,375 | 18,373 | **+4,998** | `dynamicComponent` and the hydration/claim and binding helpers the frames client imports (`assign`, `style`, `classListToObject`, `applyRef`, `DOMWithState`, the namespace tables, `getHydrationWriter`, the flash matcher) |
| `solid-js` | 13,803 | 16,786 | **+2,983** | store hydration for frames: `hydrateStoreFromAsyncIterable`, `wrapStoreFn`, `createShadowDraft`, `quietAnswer`, `applyPatches`, `withStoreHydration` (`solid.js` +2,627, `internal.js` +356); `For` (−14 lines) leaves |
| `@solidjs/web/server-functions` | 13,292 | 14,580 | **+1,288** | the frames integration of the server-function client: `frameAddress`, `configureServerFunctionsClient`, `configureServerFunctionsCodec`, `createChunk` |
| (unmapped) | 407 | 1,062 | +655 | one more chunk's import/export glue |
| `@solidjs/router` | 23,109 | 22,824 | −285 | `data/query.js` 3,490 → 3,263 (the SC twin's queries carry fewer shapes) |
| `@solidjs/signals` | 30,487 | 26,630 | **−3,857** | `map.js` (`mapArray` / `updateKeyedMap` / `trySmallMove`, 4,036) leaves with `For` |
| app | 7,418 | 1,903 | **−5,515** | the templates: `story.tsx`, `comment.tsx`, `nav.tsx`, the three route bodies (−5,034); `api.ts` 433 → 52 |
| **Total** | **101,891** | **130,471** | **+28,580** | |

**Reading.** On this release the SPA twin's client is 33.5 KB brotli as one
stream (34.2 as shipped in two files) and the SC twin's is 42.3 KB
(`dynamicComponent`) or 44.7 KB (`dynamic()`, as committed) — 46.5 per-file.
The gap is **8.8 KB (`dynamicComponent`) / 11.1 KB (`dynamic()`) one-stream,
9.9 / 12.2 KB per-file**, and it is one thing: the frames client runtime
(28.3 KB minified, ≈ 9.2 KB br, eager in full) plus the ≈ 9.3 KB minified of
`@solidjs/web`, `solid-js` and `server-functions` it retains for itself
(binding helpers, store hydration, the frame-address codec seam), against
which the SC twin sheds the SPA's templates (−5.5 KB) and `For`'s `mapArray`
(−4.0 KB). The 2.4 KB between the two SC figures is `dynamic()`'s tag arm —
`spread` and the store's prop-collection tables, retained for a source that
only ever answers with a component — which the example as committed pays
and `dynamicComponent` does not. Note the SC twin also carries a 25.5 KB
minified / 8.3 KB br `trace` tier **lazily**, which never enters these
numbers but is fetched when its feature is used. Against the maintainer's
context: the SPA on next.37 is 1.5–2.2 KB over his 32 KB estimate and the
router release accounted for a 2.7–3.4 KB drop from next.35; the SC twin is
3.1 KB (`dynamicComponent`, one-stream) below its harness figure on
next.35, of which 2.6 KB is the same router release and the rest the
bundler difference. The SC twin's eager runtime (everything but app) is
128.6 KB minified against the SPA's 94.5 KB; what the SC twin saves in
shipped templates (5.5 KB) it spends 6× over (34.1 KB) on the transport
that replaces them, so
the SPA remains the smaller first load on this release; the SC twin's case
rests on the hydration data the SPA ships in the document instead
(not measured here).

## 7. Caveats

- **Router pins.** Both twins commit `@solidjs/router` `2.0.0-next.29`;
  nothing here was measured on next.29. The override to next.37 / next.35
  was a temporary `overrides` entry in `pnpm-workspace.yaml` (plus the
  `minimumReleaseAgeExclude` entry), applied with
  `pnpm install --no-frozen-lockfile` and reverted; `pnpm-lock.yaml` on this
  branch is the committed one. The override is workspace-wide and so also
  re-pinned `examples/notes` and `examples/room` during the measurement —
  neither was built.
- **Vite plugin pin.** Both twins use the published `@solidjs/vite-plugin`
  `3.0.0-next.35` (the root `devDependencies` pin), compiling JSX with this
  checkout's `@solidjs/compiler` through the `workspace:*` override. The
  router's own `devDependencies` name `@solidjs/vite-plugin` `3.0.0-next.47`;
  that is the router's build tooling and plays no part here.
- **Source edits.** The `dynamicComponent` numbers come from a temporary
  edit of four files (`src/app.tsx`, `src/routes/{stories,story,user}.tsx`:
  the import and the four `dynamic(` calls), reverted with `git checkout`;
  the committed example still mounts with `dynamic()`.
- **Two numbers per build.** Vite emits the eager graph as 2 (SPA) or 3 (SC)
  files; the harness counts per-file brotli (the number a cap guards) and
  so does the first brotli column here. One-stream is the floor a
  single-chunk build would reach and the fairer comparison to a
  single-stream reference figure; the two differ by 0.7 KB (SPA) to 1.8 KB
  (SC) on next.37, and by up to 3.5 KB on next.35's five-file SC graph.
- **`≈ br` by package** is minified share × the containing file's ratio.
  Exact in minified bytes; approximate in brotli; not byte-comparable
  across builds (the router's `≈ br` rises 0.7 KB from SPA to SC while its
  minified bytes fall 285 — it sits in a denser chunk there).
- **Lazy chunks observed, not counted.** The 56.3 KB minified / 17.3 KB br
  `server-*.js` under `dist/client/assets` is
  `@solidjs/web/server-functions/dist/server.js` — the **server** half —
  pulled into the client's lazy graph by the router's `data/action.js`
  (`import("@solidjs/web/server-functions/server")` for `decodeFlashCookie`),
  reachable only after the lazy `serverForms` fallback. It never ships
  eagerly, but it is a server runtime in a client output directory and
  worth a look upstream. `web-*.js` (45.5 KB) is seroval + seroval-plugins,
  the lazy codec.
- **`app:src/App.tsx`** in the attribution is `src/app.tsx`: the plugin
  probes `src/App.tsx` and the macOS filesystem is case-insensitive. Same
  file.
- **Not measured:** the document HTML and the hydration payload (the SC
  twin's premise), the CSS (3.5 KB / 953 B, identical in both twins),
  gzip, any dev or `observe` build, and next.29 (the committed pin).
