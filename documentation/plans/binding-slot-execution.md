# Binding-slot execution

Status: design for review, 2026-09-29. Gap G2 in
[`examples-grid-plan.md`](./examples-grid-plan.md). Decisions recorded;
ready for implementation review.

A server component hands the client one of two slot kinds. A **template
slot** (`Slot<Args>`) is placed and filled with markup. A **binding slot**
(`BindingSlot<Args, Bindings>`, today `AttributeSlot`) is called by the
server; the client's fill returns an object whose properties the server
binds at positions — attributes, class names, style properties, handlers,
refs, and text once G1 lands — and never computes with. This doc fixes how
the binding slot's fill runs on the client.

## What runs today

`bindDataOccurrence` (`packages/web/frames/src/client.ts:384–530`):

- The fill runs inside `createMemo` (line 389). A top-level read in its body
  tracks, so an eager fill (`const done = toggled() === p.id`) re-runs on
  every change, and anything the body created — a signal, a memo, an
  `onCleanup` — is disposed and recreated with it.
- One `createRenderEffect` per occurrence (lines 420–437) computes every
  consuming element's positions from the memo's output; `assign` diffs the
  writes. A getter read there tracks, but its change re-reads every
  position of the occurrence.
- Handlers go through a frames-own listener per element (lines 462–491) that
  reads `output()[key]` at event time and fans out to every key bound at the
  event. No delegation, no `dispatchAsInteraction` wrap. Refs go through a
  stable dispatcher (lines 519–533). This replaced direct binding through
  `assign` in `04a12a069`, for handler fan-out.

The template slot's fill, by contrast, is called once, untracked, under a
per-occurrence owner, with live props (lines 689–730; `runWithOwner` clears
`tracking`). Same slot border, two execution models.

So the fill `hackernews` wants — a signal in the body, getters over it, a
handler — works today only because its memo tracks nothing and never
re-runs. One eager read added to that body and the signal resets on every
change. The model below makes the working case the contract.

## The model (settled)

1. **One call, one scope.** A binding slot is always a function. Each call
   is an occurrence; its fill runs once, untracked, under the occurrence's
   owner (the one `slotsFor` already creates, lines 605–640), with live
   args — exactly as a template slot's fill and a component body run. State
   created in the body lives as long as the occurrence. Args are optional;
   the scope is why a no-args slot is still a function.
2. **An object only.** The fill returns a plain object: plain values
   (static), getters (reactive), handlers and refs as values. Arrays, DOM
   nodes, functions and async values are excluded — at runtime the existing
   `fill-shape` finding (lines 391–403), at the type level a constraint on
   `Bindings` (below). Top-level reads are one-time reads, the same as in a
   component body; getters are the reactive form, the same as a component's
   props object.
3. **One render effect per occurrence** for its value positions, as
   today (lines 420–437). A getter's change re-reads the occurrence's
   positions and `assign` writes only what changed. This is client JSX's
   grouping: a template's dynamic attributes share one effect
   (`attributeExpressions` fixture), and the cost of the coarser group is
   re-reading a few getters, not DOM writes. An occurrence can span more
   than one server template, so it can group more than client JSX would;
   that costs reads, not effects. Text positions (G1) are the exception,
   as inserts are in client JSX: each is its own range with its own
   effect. Rebinds keep today's path (`ctx.onRebind` feeds the effect's
   consumer list; an element that leaves gets a final empty write).
4. **Handlers and refs bind once, through `assign`.** Read once when the
   element binds, untracked, and handed to `assign`/`assignProp`
   (`packages/web/src/client.ts:2534–2561`), which delegates the events
   client JSX delegates, binds tuples, wraps with `dispatchAsInteraction`,
   and removes the previous listener. A handler behind a getter is read
   once, as `onClick={cond() ? a : b}` is in client JSX. The own listener
   goes. The internal marker `on:<event>` (2.0 removed the authored `on:`
   namespace — `MIGRATION.md:580`) maps to `"on" + event`, which
   `assignProp` lowercases. Fan-out survives for refs only: several keys at
   one ref position (`_s:ref="occ:a,occ:b"`) keep the stable dispatcher.
   Handler duplicates are last-wins on the server since #3704, so a handler
   position names one key.
5. **Names.** `AttributeSlot` → `BindingSlot<Args, Bindings>`. The name
   speaks to the server author, where misuse happens: a stand-in is always
   truthy, so a binding slot's value must never be branched on, computed
   with or passed along. `DataSlot` and `PropsSlot` both read as a value to
   use.

### The type constraint

`Bindings` stays `extends object` (an F-bounded `J extends SlotOutput<J>` is
a circular constraint, TS2313), and the slot's return type becomes
`SlotOutput<J>`: `J` when valid, else a branded `SlotError<"reason">` that
fails assignment with the reason in the message.

```ts
declare const slotError: unique symbol;
type SlotError<M extends string> = { [slotError]: M };
type SlotOutput<J> = J extends readonly unknown[]
  ? SlotError<"binding slot output must be an object, not an array">
  : J extends Node
    ? SlotError<"binding slot output must be an object, not a DOM node">
    : J extends (...args: any[]) => any
      ? SlotError<"binding slot output must be an object, not a function">
      : J extends PromiseLike<unknown> | AsyncIterable<unknown>
        ? SlotError<"binding slot output must be settled, not async">
        : Extract<keyof J, `$${string}`> extends never
          ? J
          : SlotError<`reserved key: ${Extract<keyof J, `$${string}`> & string}`>;

export type BindingSlot<P = {}, J extends object = Record<string, unknown>> = {} extends P
  ? (props?: P & { $key?: string | number }) => SlotOutput<J>
  : (props: P & { $key?: string | number }) => SlotOutput<J>;
```

Prototyped (temp files, removed): `BindingSlot<{}, string[]>` errors with
the array reason both where the server reads the slot and where the client
passes its fill; `{ $x; ok }` errors with the reserved key; a valid
`Toggle` slot is untouched on both sides.

### Deferred: the accessor return

A fill returning an accessor (`() => ({ … })`) would be one effect over a
whole object. It is not added: getters are Solid's idiom for a props-like
object, `createMemo` in the body covers "compute once, share across keys",
and a function return is an error today (runtime finding and type), so
adding it later is not breaking. Revisit when real fills show getters over
one source reading as noise.

## Checks made before writing

- **The template fill runs untracked.** Yes: `runWithOwner(fillOwner, …)`
  at line 726; `runWithOwner` clears `tracking` with the owner (the
  comment at line 754 relies on it).
- **The dev signal exists.** 2.0's `STRICT_READ_UNTRACKED`
  (`08-dev-diagnostics.md:303`) fires for untracked reads in a scope
  entered with `untrack(fn, label)` (`packages/signals/src/core/core.ts:1601`);
  dev components use it with their name (`packages/solid/src/client/core.ts:284`),
  `<Show>`/`<Match>` with theirs (`flow.ts:226`, `317`). The fill runs as
  `untrack(() => fill(args), IS_DEV && "the \`row\` binding-slot fill")`.
  No new diagnostic.
- **Delegation keeps what fills rely on.** The delegated dispatcher calls
  `handler.call(node, e)` or `handler.call(node, data, e)` and simulates
  `currentTarget` (`client.ts:2621–2651`), so `this`, `currentTarget` and
  tuples behave as the own listener's do (spec "a handler position receives
  tuples…"). A non-delegated event (`myevent` in that spec) takes
  `addEventListener`. Release is `assignProp(…, undefined, prev)`, which
  clears the delegated slot or removes the listener.
- **What relies on the memo re-running.** The examples do not: `todos-server`'s
  `rowFor` and `notes`' `searchField` return getters over client state and
  handlers that read lazily; `chat`'s `codeBlock` returns one static
  handler. One spec does: the first case in
  `packages/web/test/frames-attribute-slots.spec.tsx` (line 103) computes
  `done` and `removed` eagerly from a signal and live args and asserts
  re-runs (`runs`). It is rewritten to getters, and its assertions become
  "ran once, positions updated". The case at line 878 ("a fill of getters
  … runs once") already states the model.
- **Benches.** `spread-slot-walk`, `spread-static-tail` and `border-walk`
  are server benches (`packages/web/test/server/`); nothing measures the
  client binding. Effect count is unchanged (decision 5), so none is added.

## Public API changes (flagged)

Each is a change to documented or observable behavior:

1. **An eager plain-object fill stops updating.** A top-level read in the
   fill body is a one-time read; dev warns `STRICT_READ_UNTRACKED`. Getters
   are the reactive form.
2. **State in a fill body lives as long as the occurrence** (today: until
   the memo's next run).
3. **Handlers become delegated** for the events client JSX delegates. A
   binding handler's `e.stopPropagation()` no longer stops a native listener
   on an ancestor, exactly as in client JSX.
4. **Handlers and refs are read once.** A getter for a handler no longer
   re-reads per event.
5. **`AttributeSlot` → `BindingSlot<Args, Bindings>`**, with the return type
   constrained (`SlotError`). No alias.
6. **Diagnostic code `ATTRIBUTE_SLOT_POSITION` → `BINDING_SLOT_POSITION`.**
7. **Server-side handler tuples become a finding** (decision 1).
8. **Template fills warn `STRICT_READ_UNTRACKED`** on top-level reads
   (decision 2).

## Decisions (2026-09-29)

1. **Server-side handler tuples are a finding.** Read, not yet reproduced:
   `claimEntries` (`packages/web/src/server.ts:5085–5094`) flattens an array
   at every position. At a handler position `onKeyDown={[row.key, 1]}` emits
   `_s:on:keydown="occ:key"` and drops `1` silently; `[row.key, row.data]`
   emits two keys, and the client reads `data` as a second handler and skips
   it (`typeof h === "function"`). The flatten exists for merged refs
   (`[[a, b], c]`). Fix: flatten only at `ref`; an array at a handler
   position is a dev finding (`reason: "tuple"`) pointing at the fill —
   return `onKeyDown: [handler, data]` from the fill, which `assignProp`
   binds. The data a server tuple would carry is server data the args
   already pass. Spec first (server marker, client dispatch).
2. **Template fills get the same dev signal.** They run untracked with no
   label today, so a top-level read there silently doesn't track either.
   Both fills run under `untrack(fn, label)`; a new warning in an existing
   context (flagged).
3. **No `Bound<T>`.** It would not close the gap it targets: TypeScript
   accepts any object in a condition, so `t.open ? a : b` type-checks with
   an opaque `Bound<boolean>` exactly as with `boolean`, while every
   attribute type in `jsx.d.ts` would have to accept it and the
   shared-component idiom (`TodoRow` takes `RowBehavior` on both sides)
   would need `Bound<RowBehavior> | RowBehavior`. The server's runtime
   findings catch every coercion that goes through `Symbol.toPrimitive`
   (comparison, arithmetic, template literal, `String()` —
   `server.ts:4703–4724`); truthiness has no hook in the language and is
   caught by nothing but the rule. That remaining hole is recorded, not
   closed; a type-aware lint rule could reach it.
4. **Naming.** `ATTRIBUTE_SLOT_POSITION` → `BINDING_SLOT_POSITION`; no
   `AttributeSlot` alias; the spec file, §9.2.3, the frames skill and
   `08-dev-diagnostics.md` move to the new vocabulary in the same change.

5. **One effect per occurrence** (model point 3). Per element was
   considered and dropped: it multiplied effects (four per `todos-server`
   row) to save getter re-reads, and none of the problems this doc fixes
   comes from the grouping.

## Implementation

1. Specs first, failing: a fill with a top-level signal read and a signal
   created in the body (value frozen, state survives, dev warning); a getter
   change writing only its position; a delegated handler; a release
   through `assign`; the tuple case (decision 1).
2. `bindDataOccurrence`: the fill called once under
   `untrack(…, label)` in the occurrence's owner; the shape finding on its
   result; the occurrence's one render effect over `consumers()` for value
   positions through `assign`'s diff; handlers and refs read once when an
   element binds, outside the effect's tracking.
3. Server: `claimEntries` per decision 1; the diagnostic rename.
4. Types: `BindingSlot`, `SlotOutput`, `SlotError` in
   `packages/web/frames/src/server.ts`; type tests for each rejected shape
   on both sides.
5. Docs and skill in the same PR; changeset for `@solidjs/web`; the PR
   body lists every change above under its own heading.

G1 (text positions) follows: a text position is a consumer with its own
effect beside the occurrence's value effect.
