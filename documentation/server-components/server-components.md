# Solid Server Components

*A usage-first guide to the architecture. For wire-format and runtime
mechanics, see [frame-streams-rfc.md](./frame-streams-rfc.md).*

## The idea in one paragraph

Most frameworks make you choose: islands architectures give you a lean
initial page but fall apart when you navigate; RSC-style server components
give you rich composition but ship every piece of server content twice
(once as HTML, once as serialized data); SPAs keep your client state alive
but pay for it with hydration payloads and client-side data plumbing. This
architecture — think **lakes, not islands** — keeps one copy of everything:
the server owns and streams the content (the lake), the client owns islands
of interactivity *inside* it (positions the server marks but never renders),
and neither side ever re-sends what the other already has. The test is
literal: **view-source the page or the network response and search for any
piece of content — you'll find it exactly once.**

## The mental model

Three sentences carry the whole design:

1. **A server component is a function returned from a server function.**
   The server function's *arguments* are the server's inputs (ids, filters —
   things that drive fetching). The returned component's *props* are client
   positions — holes the client fills — and never travel to the server.
2. **Props are positions, not data.** When a server component renders
   `{props.children}`, it emits a marked range in the HTML, nothing more.
   The client decides what lives there, and whatever it puts there survives
   every server update.
3. **A boundary is a call.** A server component renders into a frame
   addressed by the call that produced it — the function and its arguments,
   the same per-args rule a query cache keys values by. Re-fetching the
   same call *morphs* the server content in place; it never remounts, so
   client state inside the boundary (focus, input values, toggles, video
   playback) survives refreshes and revalidations. Different arguments are
   a different boundary: the call site swaps to it — re-materialized
   instantly from retained state when that call has shown before — rather
   than morphing one boundary across calls.

## Writing a server component

```tsx
async function getStory(storyId) {
  "use server";
  const story = await db.stories.get(storyId);

  // Returning a function makes it a server component.
  return (props) => (
    <article>
      <h1>{story.title}</h1>
      <section class="comments">
        {story.comments.map((c) => (
          <props.comment cid={c.id}>
            <div class="body">
              <p>{c.text}</p>
              {c.replies.map(renderReply /* recurse the same way */)}
            </div>
          </props.comment>
        ))}
      </section>
      <footer>{props.children}</footer>
    </article>
  );
}
```

What each piece does:

- `story.title`, `c.text` — **server content**. Rendered to HTML, streamed,
  never serialized. This is where your data lives on the wire: in the markup,
  once.
- `{props.children}` — a **direct-insert position**. The server emits an
  empty marked range; the client fills it.
- `<props.comment key={c.id} cid={c.id}>…</props.comment>` — a **render-prop
  position**, one *occurrence* per call. The client's `comment` component
  wraps each comment. Two kinds of things pass through it:
  - `cid={c.id}` — a primitive. Rides along as data (it's tiny and the
    client genuinely needs it as a value).
  - the JSX children — **server content passed into a client position**.
    This does *not* get serialized; it streams as a nested server region the
    client wraps without re-rendering. That's how recursive composition
    stays single-copy: the comment text is inside it, in HTML, once.
Rules of thumb: put content on the server; pass primitives when the client
needs a value; pass JSX when the client should wrap server content. If you
find yourself wanting to pass a big object to the client, ask whether the
client actually needs it as *data* — usually it just needs it rendered, and
rendering is free.

### Identity, if you need it (`$key`)

Most apps never write this — the defaults do the right thing. Server content
has no identity at all (it's stateless output; updates converge). A
one-of-a-kind position like `props.children` is identified by its prop name,
stable forever. Iterated positions are positional by default, and re-sends
with unchanged args are deduplicated — state inside them already survives
same-list refreshes, and resetting when the list *changes* is usually
correct.

The one case defaults get wrong is a **live list that reorders**: positional
identity means client state stays at position 0 while the entity that owned
it moves away. For that, name the occurrence by entity:

```tsx
<props.comment $key={c.id} cid={c.id}>…</props.comment>
```

If you know Solid 2.0's `<For keyed={item => key}>`, this is the same idea
in the one place references can't carry it: a response re-creates
everything, so identity across responses must be declared. Without `$key`
you have positional semantics (`keyed={false}`); with it, state follows the
entity through reorders, refetches, and navigations.

Two constraints, both by design:

- `$key` means something **only on slot calls**. On a DOM element it's
  just an attribute (server elements have no identity to name).
- Keyed occurrences must be **siblings** for reorders to follow the key —
  don't wrap each call site in its own server element; let the *client*
  wrapper (which the slot returns anyway) provide the per-item element. If a
  server-wrapped occurrence does get reordered, content stays correct but
  its client state resets.

Relatedly: `<For>` and `<Show>` inside a server component work fine, but
they're just one-shot control flow — a server component renders once per
response, so there's no live reactivity for them to manage and no interplay
with `$key`. Write `.map()` and ternaries if you prefer; they're the same
thing here.

## Using it from the client

There is no server-component API on the client. `dynamic` — the same
utility you'd use to swap any component — is the whole surface:

```tsx
import { dynamic } from "@solidjs/web";

function StoryPage(props) {
  const [collapsedAll, setCollapsedAll] = createSignal(false);

  // The source is tracked: when props.storyId changes it re-calls the
  // server function. Every call for the same (function, args) resolves to
  // the IDENTICAL component — a refetch passes dynamic's equals-gate, so
  // nothing remounts and the stream morphs the boundary in place. A new
  // storyId resolves that story's own boundary and the site swaps to it,
  // seeded from retained content when the story has shown before.
  const Story = dynamic(() => getStory(props.storyId));

  return (
    <Story
      comment={(p) => (
        <CollapsibleComment cid={p.cid} collapsed={collapsedAll()}>
          {p.children /* the server-owned comment body — wrap it, don't touch it */}
        </CollapsibleComment>
      )}
    >
      <ShareBar /* client-only; remounts with the boundary when the story changes */ />
    </Story>
  );
}
```

Things to notice:

- **Navigation is just a prop change.** No router ceremony required at
  this layer: the parent (or a router) changes `storyId`, the source
  re-calls, and the site shows that story's boundary. Two panes on
  *different* stories are independent boundaries with nothing declared;
  two panes on the *same* story share one logical stream that fans out to
  both mounts, each with its own slots.
- **`collapsedAll` never leaves the browser.** The request that fetches a
  story carries the story id and nothing else. It lives *outside* the
  boundary, so it survives every navigation; state *inside* a boundary
  belongs to its call — story 1's collapse toggles never leak into
  story 2's UI.
- **First load composes with `<Loading>`; refetches don't re-fallback.**
  The initial call is a pending promise like any `lazy` component. A
  same-args refetch resolves to the same component reference, so the swap
  is invisible to the tree — the only observable effect is the server
  content updating. An args change resolves under the same transition
  machinery as any component swap, and lands instantly when cache and
  retained content are warm.

The trick making this zero-API is a transport policy, the mirror of the
server's `frameTransformResult`: when the client's server-function runtime
sees a frame-stream response, it streams the chunks into the boundary and
resolves the call with a per-boundary stable component (get-or-create).
That component does the mounting work at its one and only mount: create
the boundary element (or claim the server-rendered one at hydration),
register its props as the boundary's slots, dispose on cleanup.

Boundary identity is **derived, never declared**, and there is exactly one
scheme: the call's intrinsic address — the function and its arguments, the
one name both peers compute independently. One logical stream per
(function, args) on the wire; one boundary component per address on the
client. Everything else falls out mechanically. A repeat call — refetch,
revalidation, preload, cache read — resolves the identical component, so
equals-gated readers hold and the stream morphs the showing boundary in
place. Different arguments resolve a different boundary, so a hover
preload for another entity streams off-screen (buffered until something
mounts it) rather than morphing what the page is showing. One component
mounted in two places fans its stream out to both frames, each with its
own slots. And because the host **retains an unmounted boundary's state**
— the store is stashed when the last frame under an address unregisters
and seeds the next mount — a call answered entirely from a client cache
(no request, no stream) still renders what that call last showed,
instantly. Freshness stays the data layer's business: a stale cache read
refetches, and the stream morphs over the re-materialized content.
(`applyFrameResponse(response, host, { as })` remains the low-level
surface routers can drive directly.)

This is deliberately the same rule a query cache uses to key values, so
cached components and boundaries stay one-to-one by construction — a
cached value never resolves a boundary that is showing some *other* call's
content.

### The data layer is the same data layer

Because fetching a server component is just calling a server function, it
composes with the data patterns apps already use rather than growing its
own:

- **Wrap the section function in `query`** and route-level `preload` warms
  it on intent — the response's chunks buffer until a boundary mounts,
  then drain. The `dynamic()` read resolves through the same cached
  in-flight call, and a later fresh cache hit re-materializes the boundary
  from retained state with no request at all — back/forward navigation
  renders like a bfcache restore.
- **`revalidate` is granular server-content refresh**: re-running the
  query streams a fresh version to every boundary bound to that logical
  stream.
- **Single-flight mutations generalize for free** (implemented): a
  mutation's response carries the markup for every server-component call
  it invalidated as regions addressed by (function, args) — the name the
  server derives from its own collection pass and the client derives from
  the calls it made — alongside the ordinary `{ value, data }` envelope,
  whose component-valued entries ride as references resolving to the very
  components those boundaries hold. One round trip settles the mutation's
  value, the data, and the UI; sections nobody currently displays buffer
  as cache warms.

Preloading, deduping, invalidation, and mutation single-flight need no
server-component-specific mechanism or API.

If a boundary ever *does* re-suspend during a refetch, nothing is lost:
Solid preserves the DOM off screen, the frame client morphs the detached
range as chunks arrive (nothing in it requires document connectivity), and
resolution restores the identical — already updated — nodes.

### Server wiring

Server components ride the ordinary server-function transport — one handler,
one hook:

```ts
import { handleServerFunctionRequest } from "@solidjs/web/server-functions/server";
import { frameTransformResult } from "@solidjs/web/frames/server";

export function handler(request) {
  return handleServerFunctionRequest(request, {
    transformResult: frameTransformResult, // fn result → streamed component
    provideEvent, // your platform's request-event scoping
  });
}
```

A server function that returns data behaves exactly as before. A server
function that returns a *function* streams it as a server component. Need
headers or a status? `return respond(Component, { status, headers })`.

## The initial page load

The first load is a normal streamed SSR document — server components render
inline, and the *client* components inside their positions render on the
server too, so the user sees a complete page before any JS runs. When the
client boots, it **adopts** that DOM rather than re-rendering it: client
components claim their already-rendered markup and bind behavior onto it.

This is where the single-copy rule pays off twice: the initial page has no
hydration data blob for server content (the HTML *is* the data) — and no
per-element hydration keys either: server-owned output renders inside a
`NoHydration` zone (adopted markup never hydrates element-by-element, so
`_hk` would be pure tax), with each client position re-entering via
`Hydration` under its occurrence namespace — those wrapper keys are the
claim keys, the only ones the page carries. The same zone suppresses
async-value hydration records, on the page and on every post-load frame
stream. And
`<Loading>` boundaries stream on first load exactly as they do on
navigation. Boot makes **zero requests** — the page itself is the payload:
each boundary's markers are the record, wrappers claim their
server-rendered nodes by hydration key, and occurrence args ride tiny
records containing only values not already recoverable from the page.

**Occlusion is handled, not leaked.** A wrapper that renders its server
content conditionally — a comment thread collapsed by default — never
renders that content at SSR, so it can't be in the HTML. The producer
tracks exactly this (evaluating a position *is* the usage signal) and
flips the transport for what went unrendered: the occluded content
serializes once as a data record, and when the wrapper finally renders
it, it mounts from the client's store with zero network. One copy,
always — as markup when rendered, as data when not, never both.

One hard rule makes this coherent: **hydration happens once, at load time,
and never again.** After the client is alive, its state has diverged from
anything the server could assume, so the server never again renders client
components — post-load responses carry server content and args only, and
client components render client-side. This isn't a limitation to work
around; it's the boundary that makes state preservation sound.

## Streaming and async

`<Loading>` (Suspense) works inside server components with no ceremony:

```tsx
return (props) => (
  <article>
    <h1>{story.title}</h1>
    <Loading fallback={<CommentsSkeleton />}>
      <Comments /* async read in here */ />
    </Loading>
  </article>
);
```

The shell streams immediately with the fallback; the comments arrive as a
later chunk and reveal in place — on the initial document *and* on every
navigation response. Client positions declared inside the async content
mount when it reveals.

## The architecture contract

For anyone building on top of this (routers, data layers, other agents
working adjacent designs), these are the invariants you can rely on and
must not break:

1. **Everything ships once.** Server content travels as HTML. Values the
   client needs travel as data records. Nothing travels as both. (At initial
   load, values already rendered into the page are recovered *from* the
   page rather than re-sent.)
2. **Hydration is t = 0 only.** Never design a flow where the server renders
   a client component after the page is interactive.
3. **The call names the content; the site owns the mount.** Content is
   keyed by its (function, arguments) address, which both peers derive
   independently — nobody declares ids, and a data layer's per-args cache
   keys agree with the transport's stores by construction. Arrival (any
   transport) only ever writes the address's store; a consumption site owns
   one mounted frame bound to one address at a time and pulls from it.
   Same call ⇒ same store ⇒ morph in place ⇒ client state inside survives.
   Different arguments at the same site ⇒ the mount rebinds and morphs to
   the new address's store — warm stores re-materialize instantly (a cache
   hit with no new stream renders what the call last showed instead of
   blank). *(Revised by the derivation pass — see
   [`server-components-principles.md`](server-components-principles.md),
   DR-1. The earlier form, "boundary identity is the call," keyed the
   mount per-args too and required handoff machinery to undo the
   remounts.)*
4. **Occurrence identity belongs to keys.** Iterated client positions keyed
   by entity id keep their state across refetches; unkeyed positions are
   positional.
5. **The server never sees client state; the client never re-renders server
   content.** Requests carry server inputs (function args). Server HTML is
   wrapped, moved, revealed — never rebuilt — by the client.

### What a router does with this

A router integration is thin by design: translate URL changes into
server-function calls and let a `dynamic` source (or
`applyFrameResponse(response, host, { as })` directly) read them — the
router names nothing, because the calls themselves name the boundaries
(invariant 3). Wrapping the section functions in the router's `query`
gives the same calls cache identity and preload participation; back/forward
that hits a fresh cache entry re-materializes the boundary from retained
state with no request, and a stale hit refetches and morphs. Scroll
restoration, pending UI, and prefetching compose on top; none of them need
to know how frames work inside.

**Link state rides the element-claim contract.** Compiled client output
claims `a[href]`/`form[action]` per element at creation
(`registerElementClaim` in the client runtime); frame content has no
compiled creation code, so the frame runtime sweeps every subtree it
materializes — initial adoption, streamed applies, reveals — and re-claims
a claimable element whenever a morph touches ANY of its attributes: the
morph makes attributes match server output exactly, which strips
consumer-applied state (`aria-current`, `data-active`), so the re-claim is
what lets the consumer reassert it (`href`/`action` transitions re-claim
even on removal).
Claims fire under the boundary's reactive owner, so a consumer that scopes
per-element state with `onCleanup` disposes with the boundary. One
registry, both render paths, no exposed wire machinery: a third-party
router that already consumes compiled claims gets server-component anchors
for free, active-state correct across morphs. Claims are emitted
indiscriminately per the attribute contract — filtering (external links,
`download`, `target`, base paths) belongs to the consumer — and the whole
mechanism is dormant (one property read per apply) without a registered
consumer.

## What it costs

Measured, min+gzip, CI-guarded: the whole client machinery — store,
streaming, slot model, transport, the stable-component policy, the
element-claim sweeps routers consume — is **~6.5 KB** for an app already
using server functions (standalone adds the shared serializer on top).
The DOM reconciler inside it is 0.86 KB — smaller than micromorph. An app
that imports none of this pays **zero bytes**; that's enforced by the same
CI guard. For scale: the frame runtime costs about as much as Solid's core
renderer itself.

## What it is not

- Not RSC: no serialized element trees, no double-shipped content, and the
  client never diffs a payload against a virtual tree.
- Not islands: the page doesn't fragment into independent apps — one
  client tree wraps and threads through the server content, and navigation
  updates the lake without draining the islands.
- Not hypermedia-with-a-morpher: server updates preserve *client-owned*
  regions structurally, with data and composition flowing through typed
  positions rather than DOM conventions.
