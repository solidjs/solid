# RFC: Server components (experimental)

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md). This RFC builds directly on [10 — Server functions](10-server-functions.md).

> **Status note:** Shipped as an **experimental preview** in the 2.0 beta line (`solid-js`/`@solidjs/web` ≥ 2.0.0-beta.24 with `@dom-expressions/runtime` ≥ 0.50.0-next.29). Server components ride the Solid 2.0 release but are **excluded from 2.0’s stability guarantees**: the API surface and the wire format may change between prereleases, and stabilization will be announced separately. The deep specification (wire format, runtime mechanics, the architecture contract for routers and data layers) lives in dom-expressions: `docs/server-components.md` (usage-first) and `docs/frame-streams-rfc.md` (wire). This document is the Solid-facing surface and its decision record.

## Summary

A **server component is a function returned from a server function** — there is no new component API, no new directive, and no `"use client"`. The server function’s *arguments* are the server’s inputs (ids, filters); the returned component’s *props* are client positions (**slots**) the server marks but never renders. On the client, `dynamic` is the entire consumption surface: a server-function call that resolves to a frame stream produces a **stable per-call component** — one boundary per (function, arguments), the same per-args rule a query cache keys values by — so refetches of the same call never remount: server content **morphs in place** underneath and client state inside the boundary (focus, inputs, toggles, video) survives server updates. A call with different arguments resolves its own boundary; the site swaps to it, re-materialized instantly from retained state when that call has shown before.

The governing invariant is **single-copy**: server content travels as HTML, values the client needs travel as data records, and nothing travels as both. The acceptance test is literal — view-source the page or a navigation response and search for any piece of content; it appears exactly once.

## Enabling server components

In a Vite app this is now one line: `serverFunctions: { components: true }` on `@solidjs/vite-plugin` (any release; the option shipped in `vite-plugin-solid` ≥ 3.0.0-next.16 before the package was renamed) (experimental, same caveats as this RFC). The option installs the server result transforms and serves component responses through the same dev middleware and production handler as server functions. When the plugin generates your entries, the document wiring rides along automatically — the render plugin, the placeholder bootstrap, and the client `installServerComponents()` call. When you author your own entries, the plugin still owns the server side; the client install and the document-SSR pieces below stay app-side. The three touch points are documented because they ARE the integration surface — the complete recipe for other bundlers and meta-frameworks (the `examples/hackernews` app uses them directly, with no Vite at all). All additive to the server-functions setup from RFC 10; the compiler contract is unchanged — the same `"use server"` directive pass, nothing new to recognize.

**1. Server — install the two result transforms** (from `@solidjs/web/frames/server`):

```ts
import { configureServerFunctionsServer } from "@solidjs/web/server-functions/server";
import {
  frameTransformResult,
  frameTransformDirectResult,
  frameTransformFlightResult
} from "@solidjs/web/frames/server";

configureServerFunctionsServer({
  transformResult: frameTransformResult,        // HTTP: function results stream as frames
  transformDirectResult: frameTransformDirectResult, // document SSR: function results render inline
  transformFlightResult: frameTransformFlightResult // single-flight: invalidated markup rides as regions
});
```

All are configurable server-wide (per-request `handleServerFunctionRequest` options still override), so this works through any generic dispatcher — including dev middlewares that call `handleServerFunctionRequest(request)` with no options. A server function returning *data* behaves exactly as before; only function-returning results engage the frames path. The third transform matters only with single-flight (RFC 10): when part of what a mutation invalidates is a server component, it answers with one frame-stream response carrying each invalidated call’s markup as a region plus the ordinary `{ value, data }` envelope. Data-only payloads keep the byte-identical plain envelope; install all three together whenever components are enabled.

**2. Client — install the transport policy once** (from `@solidjs/web/frames`):

```ts
import { installServerComponents } from "@solidjs/web/frames";

installServerComponents();
hydrate(() => <App />, root);
```

An explicit call, not a bare import — the package is `sideEffects: false` and bundlers would drop an import with no used binding. Call before `hydrate`/`render`. It configures the *shared* server-function client’s `responseHandler` seam, which is why it must be the same module instance the compiled reference proxies call through (the packaged dist guarantees this by import topology).

**3. Document SSR (optional but recommended) — the t = 0 page**: add the serializer plugin and the placeholder bootstrap to your document render:

```ts
import { generateHydrationScript, renderToStream } from "@solidjs/web";
import { ServerComponentPlugin, SERVER_COMPONENT_BOOTSTRAP } from "@solidjs/web/frames/server";

const DOCUMENT_BOOTSTRAP = generateHydrationScript() + `<script>${SERVER_COMPONENT_BOOTSTRAP}</script>`;
// in the shell’s <head> or before the app root, then:
renderToStream(() => <App />, { plugins: [ServerComponentPlugin] }).pipe(writable);
```

(`renderToStream`'s result offers `pipe`, `pipeTo`, or a `Response`-body-ready `readable` — exactly one per render; see [12 — SSR and the HTTP exchange](12-ssr-http.md).)

With this in place the initial document renders server components **inline** — the page itself is the payload. Boot makes zero server-function requests: boundaries the page carries are **adopted**, client wrappers **claim** their server-rendered DOM by hydration key, and each component’s hydration data is a one-line reference instead of a serialized tree. Without step 3, the first render client-side fetches each boundary as a stream — everything still works, you just give up the zero-request boot.

A complete working setup (no Vite, no metaframework) is `examples/hackernews`; its SSR-SPA twin `examples/hackernews-spa` is the measured baseline every published number compares against.

## Motivation

- **Islands fall apart on navigation; RSC ships everything twice.** Islands architectures give a lean initial page but degenerate to full-page loads or bespoke protocols when you navigate. RSC-style server components keep rich composition but serialize the rendered tree alongside the HTML — every piece of server content pays twice. This design — *lakes, not islands* — keeps one copy: the server owns and streams content, the client owns islands of interactivity **inside** it, and neither re-sends what the other has.
- **No new API surface.** Every prior server-components design grew a parallel component model. Here the entire client surface is `dynamic` + server functions (RFC 10) plus one `installServerComponents()` call. Boundary identity is **derived, never declared** — the call’s intrinsic (function, arguments) address keys the boundary, mirroring a data layer’s cache keys by construction, so panes over different calls are independent with nothing annotated and multi-instance mounting fans one stream out to every mounted frame.
- **Client state must survive server updates.** The failure mode that kills server-driven UIs is the refetch that blows away a half-typed reply. Policy here is structural: refetching into the same boundary morphs server content in place; teardown is disposal, never a version bump.

## Detailed design

### Writing one

```tsx
async function getStory(id: number) {
  "use server";
  const story = await db.stories.get(id);
  return (props) => (
    <article>
      <h1>{story.title}</h1>
      <section>
        {story.comments.map((c) => (
          <props.comment $key={c.id} cid={c.id}>
            <p>{c.text}</p>
            {c.replies.map(renderReply)}
          </props.comment>
        ))}
      </section>
      <footer>{props.children}</footer>
    </article>
  );
}
```

- `story.title`, `c.text` — **server content**: rendered to HTML, streamed, never serialized.
- `{props.children}` — a **direct-insert slot**: the server emits a marked range; the client fills it.
- `<props.comment …>` — a **render-prop slot**, one *occurrence* per call. Primitives (`cid`) ride as data; JSX children ride as **nested server regions** the client wraps without re-rendering — recursion stays single-copy.
- `$key` names occurrence identity for live lists that reorder (the `<For keyed>` idea at the one place references can’t carry it). Positional by default; keyed occurrences must be siblings.
- `<Loading>`/async inside server components stream as fragments with fallbacks, exactly like document SSR. Content a wrapper doesn’t render at SSR (a collapsed thread) automatically **flips transport**: it ships once as data records and mounts later from the client store with zero network.

### Using one

```tsx
function StoryPage(props) {
  const Story = dynamic(() => getStory(props.storyId));
  return (
    <Story comment={(p) => <CollapsibleComment cid={p.cid}>{p.children}</CollapsibleComment>}>
      <ShareBar />
    </Story>
  );
}
```

Navigation is a prop change: the tracked source re-calls the server function. A same-arguments refetch resolves the *same* component reference (equals-gated — `dynamic` never remounts) and the stream morphs the boundary; a new `storyId` resolves that story’s own boundary and the site swaps to it — instantly, from retained content, when the story has shown before. Client-only state never reaches the server. State *inside* a boundary belongs to its call (`CollapsibleComment`’s toggles reset per story — story 1’s collapse state never bleeds into story 2), while state *outside* the boundary (`StoryPage`’s own signals) survives every navigation. First load composes with `<Loading>`; refetches don’t re-fallback.

### What routers get

Server-component anchors and forms participate in the **element-claim contract** (the same one compiled JSX uses), so a router’s link-state layer sees server-rendered `a[href]`/`form[action]` with cleanup scoped to the boundary’s owner — active-link state works on server content unchanged, morph-precise. The `frame:applied` document event exists for coarser affordances (scroll restoration) without a MutationObserver. Boundary identity (the per-call address), versioning, and retention semantics are specified in the dom-expressions architecture contract; a router integration is deliberately thin — wrapping the section functions in `query` gives the same calls cache identity and preload participation, and a back/forward cache hit re-materializes the boundary from retained state with no request.

### The one hard rule

**Hydration happens once, at t = 0, and never again.** After boot, client state has diverged from anything the server could assume, so the server never again renders client components: post-load responses carry server content and slot args only. This is the boundary that makes state preservation sound, and it is why there is no `"use client"` — client components are simply components, and where they sit inside server content is marked by the server, rendered by the client.

## What it costs

Measured, min+gzip, CI-guarded in dom-expressions: the whole client machinery — store, streaming, slot model, transport policy, element-claim sweeps — is **~6.5 KB** for an app already using server functions. The frame reconciler inside it is 0.86 KB (guarded smaller than micromorph). Apps that import none of this pay **zero bytes** — enforced by the same guard. Argument encoding follows RFC 10’s default (plain JSON; `enableRichArguments()` to opt into codec-encoded args).

## Layering

| Layer | Owns |
|---|---|
| **dom-expressions** | Wire format (frame chunks, `slot:` markers), frame client (store/morph/host), producer/sink, transport policy, document-SSR inlining, element-claim sweeps, the architecture contract |
| **Core (`@solidjs/web/frames`)** | The Solid binding: `installServerComponents`, hydration-claim re-entry, call-address boundary identity, `getFrameHost`, the packaged subpath |
| **Router (future)** | Outlet ids, URL→call translation, back/forward re-fetch, link state via element claims, query/preload/single-flight composition |
| **Start (future)** | Configuration only, as with server functions |

## Alternatives considered

- **`createServerComponent()` / any declared API** — rejected; `dynamic` + call-address identity covers it with zero new surface. Deleted during design. (An intermediate owner/observer-captured identity — one boundary per call *site*, morphing across argument changes — was implemented and then replaced: it broke one-to-one with per-args caches, so a fresh cache hit for one args-variant could resolve a component mounted showing another.)
- **`"use client"`** — rejected; the hydration-once rule plus marked client positions make the annotation unnecessary.
- **Serialized component trees (RSC-style flight data)** — rejected on the single-copy invariant; templates never ship as data. The claim *is* the transfer at t = 0.
- **Event-based router integration instead of element claims** — rejected: `frame:applied` alone loses claim-time owner scoping and morph-precision, and would split anchors into two mechanisms depending on who rendered them.

## The derivation pass

The accumulated implementation was re-derived from explicit axioms in
dom-expressions `docs/server-components-principles.md` — the async-data treatment
applied to server components. Two headline changes to this document's earlier text:

- **Identity is split** (DR-1 there): the `(function, arguments)` address keys the
  *content store* — cache honesty, retention, and preload isolation are structural —
  while the *mount* belongs to the consumption site. An argument change at a live
  site delivers a new binding into the same instance (the semantics compiled
  components already have) instead of a component swap papered over by handoff
  machinery. Everything in this document about per-args caching, morph-in-place,
  and state survival holds unchanged; the mechanism underneath is derived rather
  than patched.
- **Async slot args are data, not holes** (DR-2/DR-3 there): plain promises and
  async iterables cross as pending records without blocking the server stream and
  suspend at the client's consumption point; reactive primitives either pass through
  as a live channel or are resolved server-side like content holes — never handed
  over raw. Async args are never reverse-templated.

## Open questions

1. **Template/block payload mode** — the wire supports send-markup-once/instantiate-many; the producer doesn’t emit it yet. Post-stabilization optimization.
2. **Reverse-templating** — recovering more t = 0 slot args from rendered content (the current recoverability check is a conservative interim). *Constrained by the derivation:* async args always ship as typed records (DR-3); recoverability applies to settled plain values only.
3. **Router retention semantics** — *resolved, now structurally*: content stores are keyed per `(function, arguments)` and outlive mounts, so a fresh cache hit re-materializes from the warm store with no request and no snapshot mechanism; single-flight mutations ship multi-frame envelopes (invalidated regions addressed by call, the `{ value, data }` outcome riding the same response, component entries as references). What remains router-side is composition only: `query` wrapping, preload wiring, revalidation bookkeeping.
4. **Stabilization criteria** — what graduates this from experimental: completion of the derivation pass (principles doc stages 2–4), wire-format freeze, router integration shipping, and the `enableHydration` granularity work.
