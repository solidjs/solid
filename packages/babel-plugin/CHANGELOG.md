# @solidjs/babel-plugin

## 2.0.0-rc.10

### Patch Changes

- fd36d37: `sourceNames.bindings`: compiled binding effects are named by what they write. An attribute effect gets `<tag>.<attribute>` as written (`span.textContent`, `div.class:active`, `div.style:color`; a template's merged effect lists all of its bindings), a hole's insert is named for the parent it fills (`div.children`), and a spread passes its tag so the runtime labels its attribute effect `div.spread` and its children insert `div.children`. The names travel as a trailing options argument on `effect`/`insert` (`{ name }`) and a trailing string on `spread`; `@solidjs/web`'s `effect`, `insert`, and `spread` accept them and put them on the render effect nodes, where the dev and observe tiers show them in owner paths, attribution chains, and the Propagation track — a binding effect reads `span.textContent ← count` instead of `effect ← count`. Production ignores the names; output with the option off is unchanged. DOM output only; `sourceNames: true` turns it on with `components`.
- fd36d37: Rename the compilers' `componentNames` option to `sourceNames`, now `boolean | { components?: boolean }`. `sourceNames: true` (or `{ components: true }`) is what `componentNames: true` was — the tag as written in source as `createComponent`'s third argument, on DOM and SSR output. The option is now the home for every kind of source name the compilers can carry into output for the dev and observe runtimes to label the reactive graph with (binding effects and primitives follow); the object form picks kinds. `@solidjs/compiler` rejects `componentNames` as an unknown option, so a stale `@solidjs/vite-plugin` fails loudly rather than compiling without labels.
- 45407d1: JSX passed through a prop other than `children` (a layout's `header`, an object of slots, a context value) now hydrates when another id-allocating hole follows it (#3567). Both compilers' hole-scope predicate treated only `props.children` as able to build hydratable content, so a `{props.header}` hole compiled to a transparent insert: the server reserved the scoped sibling's slot at registration and gave the header's elements the next id, while the client allocated in source order, and every key after the slot shifted. The predicate is now a denylist: a dynamic hole takes a scope unless its value is provably a primitive (literals, template literals, unary, binary and update expressions), so property reads, optional calls, the left operand of `||`/`??`, sequence and assignment expressions, and array literals with hydratable entries are all scoped. Ids of elements after such a hole shift by one slot on both sides.
- 6717d35: `sourceNames` follows `dev` in both JSX compilers. Unset, every kind (`components`, `bindings`) is on when `dev: true` and off otherwise; `true`/`false` sets every kind (`sourceNames: false` opts a dev build out); the object form picks, and each kind it leaves unspecified follows `dev` (previously `false`). Production output (`dev: false`) is byte-identical with the option set or unset. `@solidjs/babel-plugin`'s `PluginConfig.sourceNames` is now optional. Dev builds label components (`createComponent(Home, props, "Home")`) and binding effects (`span.children`) out of the box, so diagnostics and the Performance panel read as source without build-tool configuration.

  Primitive naming (`createSignal(0, { name: "count" })`) stays with `@solidjs/compiler`'s standalone `transformSourceNames` pass, which the build tool runs on every module independently of the JSX compiler; it is not a JSX-transform kind, and the READMEs and RFC now say so.

- 1735074: SSR: a component's props literal with getters compiles to a module-level constructor with shared getters (`hoistProps`, default on) instead of an object literal, which V8 builds in dictionary mode with a closure per getter per instance. Same own keys, order, descriptors and prototype; a props getter is now defined only for a read through its own object — copying its descriptor elsewhere throws (dev names the rule). Sites closing over a reassigned or later-declared binding, `this`, or `arguments` keep the literal. Babel and the native compiler emit the same output.
- e10a4ba: SSR: attributes written after an element's last spread are markup, not a source. `<li {...rest} class="row" data-id={id}>` compiles to `ssrElement("li", rest, …, _sk$, () => ' class="row"' + ssrElementAttribute("data-id", id))` — statics written as the template path writes them, dynamics through `ssrElementAttribute` (the spread walk's rules for one key), the whole string a literal when every part is static — with a hoisted skip predicate (`var _sk$ = k => k === "class" || k === "data-id"`, one per key set) so the spread's own copies of those keys are never read or emitted. No later source can override a trailing attribute, so the output is unchanged; the thunk runs where the trailing source's getters used to be read, so hydration ids keep their order. What goes away per element is the trailing object literal (with getters, a dictionary-mode object and a closure per getter), its key list, and the precedence check on every key of the spread — an element whose only other source is the spread now serializes from one plain object. Attributes before a spread stay a source, and a source literal with getters (`<li data-id={id} class="row" {...rest}>`) now compiles to the same hoisted constructor as a component's props (`hoistProps`). Spread-static-tail server bench, 500 rows: statics after the spread 1.31×; a dynamic and a static after the spread 1.42× (1.22× from the hoisted source form, 1.17× from the thunk on top); the same attributes before the spread 1.21×. Child properties (`innerHTML`, `textContent`, `children`), a textarea's `value`, reserved namespaces and JSX-valued attributes stay sources.
- 9adf007: Escape static text on SSR spread elements (#3557)
  - Static text children of a spread element (`<div {...props}>a &lt;b&gt;</div>`) are now HTML-escaped at compile time in both compilers, matching the template path; `script` and `style` children stay raw.
  - A static textarea `value` folded into the template (`<textarea value="a &lt;b&gt;" />`) is escaped in both compilers.
  - The Babel plugin no longer folds a textarea `value` into children on an element that carries a spread, so the value stays a prop and precedence follows JSX source order, matching the native compiler.
  - Static string props on the Babel spread paths are rebuilt from their decoded value, so `<div {...props} title="a &amp; b" />` no longer double-encodes entities.

## 2.0.0-rc.9

### Patch Changes

- 8d6de07: Native elements with several spread sources compile to the runtimes' array form instead of a `mergeProps()` call, in DOM and SSR output: `<div id="x" {...a} {...b}>` becomes `spread(el, [{ id: "x" }, a, b], …)` on the client and `ssrElement("div", [{ id: "x" }, a, b], …)` on the server. The runtimes read the sources directly — later sources win per key, only the winning source is read — with no merge proxy to build and walk, and a reactive spread is a plain thunk called inside the tracking scope, so it mints no memo and consumes no hydration id on either side (the hydratable SSR `() => mergeProps(…)` wrapper is gone for the same reason). A lone spread still passes straight through (#3105). Requires `@solidjs/web` with the `spread`/`ssrElement` array forms (#3418, #3419).
- 6d2bdeb: Move delegated event handlers off the `$$<type>` element key Solid 1 uses.

  Solid 1 delegates from `document` and fires any `$$click`/`$$input`/… it finds while walking up from the target, so a 1.x runtime on the same page — an older embedded widget, a devtools panel built on 1.x — ran every delegated handler in a 2.x app a second time. Compiled output and the runtime now stamp `_$$<type>` / `_$$<type>Data` instead; neither version can see the other's handlers, in either nesting direction.

  The key, the `_$SOLID_EVENT_OWNER` mark, and the walk rules are documented in `client.ts` as the delegated-event wire contract shared by every Solid copy on a page. Anything reading `el.$$click` directly must switch to `el._$$click`.

- 246eeeb: Emit non-identifier getter keys in compiled props literals as string literals (`get "aria-label"() {}`) instead of computed keys (`get ["aria-label"]() {}`). Same property, but a computed key drops the whole object literal off V8's boilerplate path into per-property runtime definition; on a seven-getter props literal the computed form costs ~45% more to build. Applies to every getter site in both compilers: component props, dynamic element attributes (DOM, SSR, universal).
- 63560a1: `componentNames` now applies to SSR output. Under the option both compilers keep the `createComponent` call they otherwise inline to `Comp(props)` and pass the source tag name — `createComponent(Comp, props, "Comp")` — so the server runtime's observe/dev `createComponent` labels the owner and a server finding's `ownerPath` reads `<App> › <Page>` like the client's. Without the option (prod builds) SSR output is unchanged. `@solidjs/vite-plugin` already passes the option for its dev and observe postures, so app server builds pick this up with no config change.

  Fixes `ssrScope` under transparent owners: the virtual hole scope swapped the current owner's id counter, but content inside a hole resolves ids by walking past transparent owners, so with one in between (the server-component scope owner; now the labelled component owner) the hole's content took ids from the enclosing counter and disagreed with the client. The scope now swaps the nearest id-bearing owner.

- 350f65f: TSRX: `@for … index/key` items and `@catch` errors pass through to `For` / `Errored` as the accessors Solid hands out; the compilers no longer rewrite reads of those bindings into calls (#3474). Author `item()`, `i()` (under a custom key), and `err()` exactly as in JSX. A destructuring pattern in one of those positions is rejected with a diagnostic, since there is nothing to destructure — the default keyed `@for` item is still a raw value and still destructures. `projectTsrxForTypecheck` emits the same `(item, i) =>` / `(err, reset) =>` arrows `@tsrx/solid` does, so the two typecheck projections now agree.
- 1643d2a: The universal renderer's `spread()` follows the `@solidjs/web` contract (#3388): `ref` folds into the props effect and is re-applied only when its identity changes (refs run with no owner, so nothing they create is disposed by the fold); children keep their own owned `insert` — that effect owns the child subtree — but a plain object whose `children` is a data property inserts the value with no effect at all. Three reactive nodes become two when children flow through the spread, one when they don't. `spread` also resolves a lone function source inside its own tracking scopes and accepts an array of sources — `spread(node, [a, b], skipChildren)` — the union of their keys with later sources winning, only the winning source read, function sources called inline with no merge and no memo. Both compilers' universal output uses it: a lone spread passes straight through (reactive included, no more `mergeProps(() => …)`), and several sources compile to the array instead of a `mergeProps()` call.

## 2.0.0-rc.8

### Patch Changes

- 01ac18c: Compiler `componentNames` option: component owner labels that survive minification. With the flag on, DOM output carries the tag as written in source as a third `createComponent` argument — `<Home />` compiles to `createComponent(Home, props, "Home")`, `<Ui.Button />` to `"Ui.Button"`, `<this.Row />` to `"this.Row"` — and the dev and observe runtimes label the component's owner with it (`<Home>` in diagnostic `ownerPath`s, attribution chains, and the devtools `_component.name`), falling back to `Comp.name` as before. Until now an observe-tier production bundle reported hot scopes and holds under whatever the minifier left of the function name (`<Xt> › <Kn>`), and a `lazy()` or HMR wrapper hid the tag name even in dev. Off by default and byte-identical output when off; SSR (which inlines the call) and universal output never emit it; the production `createComponent` ignores the argument. Both compilers implement it in parity (shared fixtures, cross-mode ratchet). `@solidjs/vite-plugin` enables it for the dev and `observe` postures.
- 7d985b6: Fix SSR XSS: strings yielded by flow-control memos rendered unescaped

  `<Show when={s}>{s}</Show>`, `<For>{v => v}</For>`, `<Dynamic component={() => s} />`,
  `<Switch>/<Match>`, boundary fallbacks and any component that returns a string through a
  memo rendered that string raw on the server. The server flow controls return memos for
  hydration-id alignment; `escape()` passed functions through by identity, and the resolver
  appended whatever they later produced without escaping.

  One rule now: `escape(x)` at a hole covers everything reachable from `x` — strings, array
  items, and what a function yields when the resolver calls it (a deferred-escape wrapper).
  Finished `{ t }` nodes pass through. `Loading` escapes its content the way it already
  escaped its fallback. The compilers stop wrapping fragment / mixed component children in
  `_$escape` (they are values; escaping them too double-escaped through
  `<Comp>{props.children}</Comp>`), and a single-expression fragment at a hole keeps the
  hole's wrap. Live-hole tags ride the wrapper and `$slot` survives the array copy, so
  frames behave as before.

- ab4c40c: Object-valued `style` / `class` bindings are read in the TRACKED half of their effect. `style()` and `className()` enumerate their object in the effect's untracked commit phase, so a proxy value — a store sub-object (`style={state.style}`, `class={row.classes}`), merged props, anything arriving through a spread — was identity-reactive only: in-place key mutations never re-applied, and every leaf read tripped `STRICT_READ_UNTRACKED` in dev. Both compilers now wrap the compute value of a non-inline `style={expr}` / `class={expr}` in a new compiler primitive, `readShallow()`, and `spread()` applies it to those two keys as it copies. `readShallow` is an identity passthrough for strings, plain objects and proxy-free arrays (a fresh literal is already the compute's own — the common case pays a `typeof`); a proxy is copied with one `ownKeys` trap (its own trap keeps the key set tracked) plus one tracked read per key; arrays are re-mapped only when an element is a proxy. Inline literals are untouched — they already compile per property. Provably-string expressions (string/template literals, concatenation) and literal objects/arrays skip the wrap at compile time. New Tier-1 bench `style-class-object`: plain-object rows at parity; store-backed rows go from identity-only (and, in dev, ~97 ms per 500 elements of diagnostics) to per-key reactive at ~3.5 ms. Octane svg-dashboard (prod build, store-backed style/attrs through spread): mount at parity, style_spread_pulse −6%, select_toggle −7%.

  `spread()` shares the same enumeration: its compute half copied the source with `for…in` + `hasOwn`, which on a proxy source (`merge()`/`omit()`, `{...props}` in a component, store records — nearly every spread) is an `ownKeys` trap plus two `getOwnPropertyDescriptor` traps per key, each allocating a descriptor and a getter closure. It now takes the key set from one `Reflect.ownKeys` trap (the trap keeps the key set tracked) and reads each string key once; plain sources use `Object.keys`, the exact own-enumerable set the old loop yielded. New Tier-1 bench `spread-enumerate` (500 elements, 8 keys): `merge(static, reactive)` 376 → 537 ops/s (+43%), store record 253 → 415 ops/s (+64%), plain object at parity.

## 2.0.0-rc.7

### Patch Changes

- ead7b1a: Keep hydration IDs aligned when an intrinsic element has a ref and one reactive spread.
- b3586e8: Validate document-shell templates in the document context (#3259). The `validate` pass round-trips templates through a body-context fragment parse, which strips `<html>`/`<head>`/`<body>` wrappers no matter how well-formed the markup — so once #3099 made validate failures compile errors, a root component owning the document shell failed to compile in plain client mode, and merely importing it (the jsdom component-test configuration) was fatal. Shell-rooted templates now parse as a document and the shell element is compared back — the analogue of the synthetic `<table>` wrap for table partials, in both the Babel plugin and the native compiler. Genuine restructuring (an implied `<head>`, flow content in `<head>`, a `<p>` split in `<body>`) still errors. Since `<template>` parsing flattens shells, actually client-creating one now throws a descriptive dev-mode error from `template()` pointing at `hydrate()` — the failure moved from every import to the one broken act.
- d601119: Remove the experimental patch channel and patch-mode list driver (always opt-in, never default). Graph-native regions own value delivery and the unified-For design owns list structure, so the channel's parallel delivery machinery is retired: `patch.ts`/`patch-driver.ts` deleted, the compiler-contract exports (`registerPatch`/`registerRowOps`/`registerSlotPatch`/`patchableRaw`, `patchDriver`/`rowProof`/`driveList`) removed, the `patchDriver` compiler option dropped from both compilers, the insert `$ll` seam stripped, and the write-side channel struct dieted to the single written-keys bound (`t.wk`) the core fold/notify paths actually use. Store-family app bundles reclaim up to ~900 B brotli; every measured tier shrinks.

## 2.0.0-rc.6

### Patch Changes

- 1e7fa73: Reject authored TSRX lazy destructuring in Solid while retaining deferred patterns generated for keyed loops and catch clauses.
- bbff5e0: Direct `value`/`checked` (and other stateful DOM property) bindings no longer overwrite pre-hydration user input during the hydration claim pass (#3182). Hydratable compiled output now routes locked DOM properties through `setProperty`, which skips writes on hydrating nodes and carries the `<select value>` microtask and input/textarea nullish special cases.
- cdbd584: Assign static `<select value>` values through the live DOM property so the matching option is selected consistently with reactive values.
- 5a1abb3: Compile TSRX loops with an index but no explicit key using Solid's non-keyed callback shape.
- 82868c6: Support recursive lazy destructuring, lazy arrow parameters, per-read defaults, computed keys, rest views, standalone assignments, accessor-backed keyed-loop and catch patterns, and JavaScript-correct writes and updates across the Babel and native TSRX frontends.
- 774aad5: Add compile-time scoped styles, CSS sidecar output, style class maps, and style refs to both TSRX frontends.
- c9c16cb: Add an experimental TSRX syntax frontend to both compilers. `.tsrx` sources (routed by filename with the new `syntax: "auto" | "jsx" | "tsrx"` option) desugar `@if`/`@else`, `@for … @empty`, `@switch`/`@case`, `@try`/`@catch`/`@pending`, `@{}` statement containers, and lazy destructuring (`&{}`/`&[]`) into the shared Solid JSX lowering, producing byte-identical output from both compilers. The Babel plugin loads the optional `@tsrx/core` peer dependency lazily; the native compiler ships the frontend behind the default-on `tsrx` cargo feature (statement containers in expression position are rejected with a structured diagnostic pending upstream oxc-tsrx support).

## 2.0.0-rc.5

### Patch Changes

- 320f1f5: Universal text is text (#3127). The DOM and SSR generators splice static
  text into an HTML template that a parser later unescapes, so they escape
  static values and keep JSX entities as written. The universal generator
  hands strings straight to the host — `createTextNode`, `setProp` — with no
  parser downstream, so the escaping rendered literally (`{"<b>"}` showed as
  `&lt;b>`) and entities never decoded (`&lt;` showed as `&lt;`), leaving no
  spelling that produced a literal `<` in static text under a custom
  renderer. Universal-rendered element children now pass static values
  through unescaped and decode JSX entities in text and string attributes,
  matching what component children and fragment text always did. The flag
  rides on the element, not the config, so `generate: "dynamic"` decides per
  renderer. Applied to both compilers; the attribute half closed ten pinned
  cross-mode parity divergences between them. Reported with the fix mapped
  out by @antoinevanwel.
- 5230666: Fix hydration ids drifting after a reactive lone spread (#3105). A lone spread now passes its accessor straight to `spread()` on the client — no `mergeProps`, no memo, no hydration id — matching the server's existing pass-through fast path. The runtime resolves a function props source inside its own tracking scopes.
- e27dc29: `validate` now fails the compile instead of warning when a template's markup would be restructured by the browser's HTML parser (#3099). Once the validator fires the emitted positional walk is guaranteed not to match the browser-built DOM (crashed or silently misplaced bindings; desynced hydration under SSR), so warn-and-emit shipped certain breakage with the diagnostic buried in server logs. Errors now point at the offending JSX (code frame in Babel, line:col in the native compiler). `validate: false` remains the opt-out.

## 2.0.0-rc.4

### Patch Changes

- 8d249c7: Patch-channel contract hardening from the stage-2 re-audit: ordinary `patchDriver` registrations unbind with their owner (entries no longer leak past unmount); merged transitions move their held-patch stash so no patch strands; the optimistic drain shares the normal drain's per-entry error isolation and boundary routing; accessor-bearing records are excluded at admission (scan-before-trust) and records that acquire accessors demote their patches to tracked effect fallbacks; writable projection arrays emit setter row ops at their fold-commit visibility moment; row-ops/slot registrations resolve chained backings to the ultimate owner; duplicate keys match occurrence-aware instead of first-wins; the production dev-token typo (`_DX_DEV_`) is fixed; `patchDriver: true` normalizes identically in Babel and the native loader, the option is typed in `TransformOptions`, and a `dom-patch` parity tier ratchets patch-mode output across both compilers (currently byte-identical on all fixtures).
- b534733: Scope-wrap bare function children in hydratable mode. A function child (`<main>{() => <App/>}</main>`, including via the `children` attribute) is a deferred hole at runtime, but it never classified as `dynamic`, so neither generate reserved an id scope for it — its owner ids drifted across async retry passes on the server and desynced from the client (the #2900 hydration-id-parity class). Both compilers now treat syntactic function expressions as scope-eligible alongside dynamic values, emitting `_$scope(...)` in the ssr generate and around the matching insert accessor in the dom generate. The native compiler also unwraps TS casts in the allocate-ids predicate, matching Babel (fixes a scope-emission desync for `{call() as any}` children).

## 2.0.0-rc.3

### Minor Changes

- 89a0531: Absorb the 0.50 expressions snapshot into this repo: lift compilers as `@solidjs/babel-plugin` and `@solidjs/compiler`, dump runtimes into `@solidjs/web` / `h` / `html` / `universal`. Origin: ryansolid/dom-expressions@e97e4290 (0.50.0-next.44).
- 89a0531: Collapse the expressions dump: drop the rxcore seam, flatten runtimes into package `src/`, delete `babel-preset-solid`, and publish compiler natives as `@solidjs/compiler-*`.

### Patch Changes

- 47a797e: Drop leftover DOM Expressions loader fallbacks and reframe the compiler and Babel plugin as Solid 2.0 packages. Node `transform()` now defaults `moduleName` to `@solidjs/web` and `builtIns` to the Solid control-flow set, matching `@solidjs/babel-plugin`. SSR leaves a sole component child unescaped (it is a value; the callee's insert sites escape) and only HTML-escapes mixed/fragment children and element holes. Local native builds remain usable when an in-repo platform-package stub has not been populated yet.
- 0d2810a: Fix Babel and native compiler lowering divergences around nested content, custom-element ownership, static attributes, namespaces, and conditional evaluation order.

The Babel compiler implementation joined the SolidJS 2.0 monorepo at `2.0.0-rc.2` under the temporary `@solidjs/babel-plugin-jsx` name. It adopted this syntax-neutral package name before the integration merged. Earlier releases lived in [DOM Expressions](https://github.com/ryansolid/dom-expressions).
