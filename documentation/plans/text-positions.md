# Text positions

Status: implemented 2026-09-29 (principles §9.2.5). Gap G1 in
[`examples-grid-plan.md`](./examples-grid-plan.md); builds on
[`binding-slot-execution.md`](./binding-slot-execution.md) (G2), and lands
after it. Where the build departed from this text it is corrected in place,
marked _(as built)_.

A binding slot's value placed as a child — `<a>{t.label}</a>`,
`<strong>{list.remaining}</strong> items left` — becomes a position the
client owns, as attributes, class names, style properties, handlers and
refs already are. Principles §9.2.3 deferred it ("needs a marker pair in
content, deferred to keep this round to attributes"). `hackernews` needs it
for the toggle's label; `todos-server`'s count wants it.

## What happens today

- **Server.** A compiled child hole passes the stand-in through `escape`
  unchanged (non-attribute objects return as-is, `server.ts:5311–5340`), and
  the resolver's branch for it (`server.ts:5962–5969`) renders nothing on
  either face and raises the `text` finding (`slotTextPosition`,
  `4750–4762`): "Text is not a bindable position yet."
- **Attributes, for comparison.** `slotAttribute` (`4814–4824`) renders the
  t=0 value on the document face (`sv.f === SLOT_FACE_DATA`), nothing on the
  stream face, and a marker either way; the client writes the value when it
  binds. The morph reads the incoming element's markers and leaves owned
  positions alone (`ownedPositions`, `frame-client.ts:2555–2577`).
- **The morph and text.** Comments and text nodes are always `compatible`
  (`frame-client.ts:2522–2526`) and `morphNode` overwrites their data
  (`2685–2687`). A client-owned text node would be reset to the server's
  text on every refetch — empty on the stream face — and with no consumer
  change nothing rewrites it. Skipping owned text in the morph is required,
  not optional.

## The model

1. **Server emit.** The resolver branch becomes a marker pair around the
   value: `<!--_s:t=<occurrence>:<key>-->` + text + `<!--/_s:t-->`. On the
   document face the text is the t=0 value, escaped; on the stream face it
   is empty — exactly `slotAttribute`'s split. `null`, `undefined` and
   booleans render empty, as a client insert renders them. A markup-face
   read (`sv.f === SLOT_FACE_MARKUP`) keeps `slotMarkupRead`'s finding and
   emits an empty pair. The entry is `slotEntry`'s encoding, whose alphabet
   has no `>`, so the entry cannot close the comment. After the pair
   `ssrTextTail` is false: comments already separate text nodes.
2. **Why a pair.** A single start marker cannot work on either face: on the
   stream face the value is empty, so there is no text node to find; on the
   document face the value merges with adjacent static text into one node
   (`3 items left`). The end marker bounds the range in both cases.
3. **Discovery.** `collectSlots` (`frame-client.ts:2349–2380`) already
   visits every child node of server-owned elements, and already tests
   comments (`slotStartId`). A text start marker registers a consumer
   position `{ pos: "text", key, start }` on its parent element, beside
   that element's attribute positions, and the walk continues after the end
   marker. It never enters slot-range interiors or nested frames, so only
   server-owned markup can hold one. `consumersEqual` also compares
   `start`. No parent-element marker is needed: the walk that finds slot
   ranges finds these at no extra traversal. _(As built: the position
   joins the parent's EXISTING consumer entry for the occurrence when its
   attribute markers opened one. Two entries for one element each treat
   the other's handler as released — a counter button,
   `<button onClick={row.bump}>{row.count}</button>`, lost its handler.)_
4. **Client write.** The occurrence's one value effect writes a text
   position as `node.data = String(v)` into the range's one text node,
   creating it between the markers when absent (the stream face, or an
   empty t=0 value). Primitives only: a string or number renders; `null`,
   `undefined` and booleans clear; anything else (an object, array, node,
   function) is a dev finding (`reason: "text-shape"`) and clears. Markup
   belongs in a template slot. Client JSX gives an insert its own effect
   because an insert takes any content (arrays, nodes, components) and
   reconciles it; a primitive-only text write is attribute-shaped, so it
   joins the occurrence's effect with the other value positions.
5. **Morph ownership.** In `reconcileChildren` (`2863–2974`), an incoming
   text start marker meeting an old one with the same data skips both
   ranges, keeping the old interior — the text analogue of the
   same-slot-range skip at `2882–2887`. Any other case falls through to
   ordinary reconciliation: the incoming pair lands, the sync sees the
   consumer change, and the owning occurrence writes it. A text position
   released by the server (its markers gone) is the server's again and gets
   no final write — the rule `write()` already applies to released value
   positions (`frames/src/client.ts:447–454`).
6. **No relocation index.** Slot ranges are indexed frame-wide so a range
   moved under another parent keeps its live interior. A text range's
   interior is one text node the client rewrites on rebind, so there is
   nothing worth carrying: text ranges match sibling-scoped only.

## Checks made before writing

- The compiled server template needs no change for ordinary parents: the
  hole already reaches the resolver with the stand-in. _(As built: two
  resolvers, not one. `resolveSSRNode` sees it under live holes and in
  element children; `tryResolveString`, a `ssr()` hole's sync path, sees
  it under `renderToString` and through a component's `children`, where
  it fell to `unrecognizedInsert`. Both emit the pair.)_
- Occurrence, key and encoding reuse `slotEntry`/`encodeSlotKey`
  (`server.ts:4794–4805`); the client decodes as `slotPositions` does.
- Existing server spec to rewrite: `frame-binding-slots.spec.tsx:986`
  ("a stand-in placed as text … renders NOTHING at t=0 too"). Its
  stringified and coerced cases stay findings.

## Public API changes (flagged)

1. **A binding-slot value as a child renders and binds.** Today it renders
   nothing and warns; afterwards the document face shows the t=0 value and
   the client owns the text. Documented behavior in §9.2.3 ("a text child
   — is a dev finding and renders nothing on either face") changes.
2. **The `text` finding reason is retired**; a new reason, `text-shape`,
   names a non-primitive value at a text position.
3. **New wire marker** `<!--_s:t=…-->` / `<!--/_s:t-->` in server
   component HTML (internal protocol, but visible in the output).

## Decisions (2026-09-29)

1. **The occurrence's effect writes text** (model point 4), not an effect
   per text position; `binding-slot-execution.md` and the plan are
   corrected to match.
2. **Raw-text parents are a documented rule, not a check.** Inside
   `<textarea>`, `<title>`, `<style>` and `<script>` a comment is literal
   text, so the markers would land in the text. Nothing can see this
   cheaply: the resolver does not know the parent, and the SSR compile is
   one compile — `serverComponents` is a setting on it, not a separate
   transform — whose child holes in those parents already go through the
   ordinary `_$ssr` hole (`attributeExpressions` fixture, lines 482 and
   562), so a compiler check would add a code path to every SSR output
   for a misuse only server components can make. The rule: a binding
   value is never the content of a raw-text element — `<textarea>` binds
   `value=`, a style binds a style property. In `<textarea>` and
   `<title>` a violation is visible on first render (the markers show as
   text); in `<style>` and `<script>` it can fail silently, where a client
   value has no idiomatic use. Revisit if the SSR compile ever needs
   raw-text awareness for its own reasons.
3. **Marker spelling** `<!--_s:t=<occurrence>:<key>-->` /
   `<!--/_s:t-->`, as proposed.

## Implementation, after G2

1. Specs first, failing, on both faces: marker emission and escaped t=0
   value; nullish and boolean empty; adjacent static text kept separate;
   stream-face bind; a getter update; a refetch keeping client text;
   another occurrence taking the same position; server release; a
   non-primitive finding.
2. Server: the resolver branch; `slotTextPosition` removed. No compiler
   change. The writer rides on the stand-in (`slotValue` sets it), so the
   resolvers only call it: a server render with no binding slots does not
   retain it (the `renderToString` floor, #3722).
3. Client: discovery in `collectSlots`, `consumersEqual`, the write in the
   occurrence's computation, the morph skip.
4. Docs in the same PR: §9.2.3 (text joins the position kinds; the finding
   list and the open item, and the raw-text rule), the frames skill,
   `08-dev-diagnostics.md`; changeset for `@solidjs/web`.
