# Assessment: Branded Store Types — deep `Store<T>` + `StorePart<T>` (#3092)

**Status:** design assessment only — nothing here is implemented.
**Scope:** [issue #3092](https://github.com/solidjs/solid/issues/3092) and its reference branch `brenelz/solid@store-brand-types` (commit `3ef6afe3`, 15 files, +207/−50).
**Verification:** every load-bearing type-level claim below was probed against `typescript@6.0.3` (the repo's version); the probe results are labeled **[verified]** / **[reproduced]** / **[new finding]**.

---

## 1. Current state of the store types

The entire "store-ness" of the public type surface today is one alias:

```8:8:packages/signals/src/store/store.ts
export type Store<T> = Readonly<T>;
```

Everything else routes through it:

- `createStore` (plain form): `(store: NoFn<T> | Store<NoFn<T>>, options?) => [Store<T>, StoreSetter<T>]`
- `createStore` (derived form) / `createProjection` / `createStoreDerivedNext`: seed typed `Partial<T> | Store<NoFn<T>>`, returning `Refreshable<Store<T>>`
- `createOptimisticStore`: `NoFn<T> | Store<NoFn<T>>` seed
- `solid-js` server entry (`packages/solid/src/server/signals.ts`): four overload sets of its own using `T | Store<T>` / `Partial<T> | Store<T>` unions, plus `Store<T>` in the hydration wrappers
- `StoreSetter<T>` drafts against plain `T` (drafts are deliberately un-readonly and would stay unbranded — a good pre-existing separation the proposal preserves)

Because `Readonly<T>` is a shallow homomorphic alias, the issue's complaints are accurate and easy to confirm:

- `Store<Todo[]>` normalizes to `readonly Todo[]` at the *first binding* — the word "Store" never appears in a hover again.
- Every nested view (`todos[0]`, `store.user`, `.filter()` elements, `<For>` items) types as plain `Todo` while being a live reactive proxy at runtime.
- A store view flows silently into `(props: { todo: Todo })` — the receiving code cannot know (and tooling cannot detect) that it holds reactive state.
- There is no anchor for type-aware tooling: alias names do not survive `Omit`/`Pick`, generic inference, or mapped types.

Adjacent type machinery that any change must coexist with: `NotWrappable` (with the `SolidStore.Unwrappable` augmentation hook), `NoFn<T>`, `Refreshable<T>` (an intersection wrapper), `storePath`'s `KeyOf<T>`/`Part` types, and `merge`/`omit`'s `keyof`-driven `Override`/`OverrideSpread` types.

## 2. The proposed design

```ts
declare const STORE_BRAND: unique symbol;
export interface StoreBrand {
  readonly [STORE_BRAND]?: true; // optional: labels, never rejects
}

type StoreValue<V> = [V] extends [NotWrappable]
  ? V
  : IsStoreType<V> extends true
    ? V
    : StorePart<V>;

export type StorePart<T> = { readonly [K in keyof T]: StoreValue<T[K]> } & StoreBrand;
export type Store<T>     = { readonly [K in keyof T]: StoreValue<T[K]> } & StoreBrand;

/** Keyed discrimination — assignability can't discriminate an optional brand. */
type IsStoreType<T> = [typeof STORE_BRAND] extends [keyof T] ? true : false;
```

Three ideas stack here, and they are separable:

1. **A phantom brand** (`& StoreBrand` with an *optional* symbol property) — makes the type nominally recognizable without rejecting structural producers.
2. **A deep homomorphic map** (`StoreValue`) — makes the brand *survive* member access, array methods, and inference, and makes nested arrays `readonly` at the type level.
3. **A second name** (`StorePart<T>`, structurally identical to `Store<T>`) — pure hover/documentation distinction between "the root you created" and "a view into one".

## 3. Verified type-level behavior

All probes were run standalone against `typescript@6.0.3` with `--strict`.

**[verified] Transparency is preserved where promised.** Plain data assigns into `Store<T>` positions (seeds, fixtures: `const s: Store<Todo[]> = plainTodos` is clean), because the brand property is optional. Primitive-only shapes still assign *out* into plain types (`Store<{id: number, title: string}>` → `{id, title}` is clean) — the documented residue that structural typing cannot reject and a lint rule would have to cover.

**[verified] The brand survives where the alias dies.** `todos[0]` is `StorePart<Todo>`; `todos.filter(...)` elements keep the brand; the keyed `IsStoreType` probe discriminates both, and survives intersections like `Refreshable<Store<T>>` (`keyof` of an intersection unions the members' keys). The homomorphic map preserves tuples, optionality (`?`), and function-typed members.

**[verified] Array-bearing shapes are rejected from plain-typed slots.** `Store<{rows: Row[]}>` does not assign to `{rows: Row[]}` (readonly-array variance) — the compile-time catch the proposal advertises.

**[new finding — sharper than the issue states] The rejection also applies to `Readonly<T>` slots.** The issue says "`Store<T>` still flows anywhere `Readonly<T>` is accepted." That is only true for shapes without nested arrays: `Readonly<T>` is shallow, so `Readonly<Todo>` still wants `tags: string[]` and a `StorePart<Todo>` (with `tags: readonly string[]`) is **rejected**. Any downstream signature that today types a parameter as `Readonly<X>` (or plain `X`) with arrays anywhere in it stops accepting store views. This is the real migration surface, and it is *by design* — but it must be named accurately: the breaking boundary is "arrays anywhere in the shape", not "mutable slots" narrowly.

**[new finding — positive] Discriminated unions survive.** Homomorphic mapped types distribute over union instantiations, so `Store<{shape: Circle | Square}>` gives `StorePart<Circle> | StorePart<Square>`, and `if (s.kind === "circle") s.radius` narrows correctly. The proposal doesn't discuss unions; this was the likeliest silent-breakage candidate and it checks clean.

**[verified] `keyof` pollution is real but bounded.** `keyof Store<T>` includes the phantom symbol, so it is not `extends string`. Generic helpers in this repo that map `keyof T` over *user-supplied* type arguments (`merge`/`omit`'s `Override` types, `storePath`'s `KeyOf`) will carry the phantom key through their outputs when handed a branded type. Since the symbol has no value-level export and the property is optional, this is completion/display noise rather than unsoundness — but `keyof S & string` discipline becomes a documented idiom, and the repo's own utility types should be audited once against branded inputs.

**[reproduced] The tsc stack overflow is real — with the exact signature shape shipped today.** A minimal `Partial<T> | Store<T>` union did *not* crash. The crash reproduces with the repo's real shape — `NoFn<T> | Store<NoFn<T>>` in the plain-form overload — called with an object literal carrying a `this`-typed getter:

```ts
const [a] = createStore({
  base: 2,
  get double() { return this.base * 2; }  // RangeError: Maximum call stack size exceeded
});
```

`tsc` 6.0.3 dies in the type-node printer (`createTypeNodesFromResolvedType` recursion) trying to relate the literal's `this`-type through the deep mapped type inside the union. Two important qualifiers found while reproducing:

- **The baseline already trips on this shape.** With today's unbranded `Store<T> = Readonly<T>` and the same union, the same literal produces `TS7023` ("'double' implicitly has return type 'any'…") and `TS2615` ("circularly references itself in mapped type"). The deep brand escalates a pre-existing *error* into a checker *crash* — worse, but not a regression from a previously-clean shape.
- **The branch's fix works.** Splitting every `X | Store<X>` union into ordered overloads (plain arm first, `Store<T>` fallback second) checks the same calls clean, including `Store` seeds binding through the fallback. One diagnostic remains on `this.base` under the `Partial<T>` arm (possibly-undefined) — probed to be **pre-existing** with today's types, not introduced by the brand.

**[risk — not fixable in this repo] Userland unions re-create the crash.** The branch fixes internal signatures, but nothing stops an application from writing `function f(x: Config | Store<Config>)` and feeding it a `this`-getter literal — their build then crashes with a stack trace pointing at tsc, not at their code. This is the strongest argument for caution: we would be shipping a public type that composes into a checker crash under a written-in-the-wild pattern. It should be filed against TypeScript with the minimal repro regardless of the decision here.

## 4. Costs and gaps

- **Migration surface.** Every downstream signature accepting store-derived data with arrays in it must switch to `readonly` arrays, `Store<…>`/`StorePart<…>`, or generic inference. The branch's own diff shows the shape of this: seven of its fifteen files are tests updated to the new annotation discipline. Within a 2.0-rc window this is the cheapest it will ever be; post-stable it would be a semver-major type change.
- **Checker cost.** Deep mapped types instantiate per distinct access path. The branch reports signals typechecking at its exact pre-existing error baseline with no slowdown claims, but no measurement on a large consumer exists. Should be measured (e.g. `tsc --extendedDiagnostics` on solid-start or a large app) before this stabilizes.
- **Platform/class types get mapped even though the runtime serves them raw.** Runtime `isWrappable` excludes native-branded objects (`Map`, `Date`, DOM nodes) via tag checks; the type level cannot see that, so `Store<{m: Map<K,V>}>` types `m` as `StorePart<Map<K,V>>` — structurally compatible in most positions but a lying hover (the runtime serves the raw `Map`). The existing `SolidStore.Unwrappable` augmentation hook is the escape hatch and gains real significance under this proposal; the docs for `markRaw` should point at it.
- **`snapshot()` (and any future unwrap) must strip the brand.** `snapshot<T>(value: T): T` handed a `Store<Todo[]>` infers `T = Store<Todo[]>` and returns a *branded* type for what is actually a plain deep copy. The branch does not address this. Needs an overload or an `Unbrand` helper:

  ```ts
  type Unstore<T> = T extends StoreBrand
    ? { -readonly [K in Exclude<keyof T, typeof STORE_BRAND>]: Unstore<T[K]> }
    : T;
  export function snapshot<T>(value: Store<T> | T): Unstore<T>;
  ```

  (`deep()` is fine returning the branded type — it returns the store itself.)
- **`StorePart` vs `Store` is naming-only.** They are mutually assignable and identical; the two names exist purely for hovers. That is defensible (the issue argues it well), but it doubles the exported surface for zero checker semantics — worth an explicit call, and worth documenting that `StorePart` in a props type is the *recommended* annotation for "I receive a view".
- **Rejected alternatives (agree with the branch's findings):** a *required* (truly nominal) brand breaks seeds and every structural producer — correctly rejected. Leaf flavoring (`number & StoreLeaf`) follows copies into dead locals and lies — correctly rejected. A root-only shallow brand (`Readonly<T> & StoreBrand`) was evaluated here as a lower-risk middle ground: it fixes nothing the issue actually complains about (the brand dies at the first member access, exactly like the alias name), so it is not worth its own migration. It's deep or nothing.

## 5. Recommendation

**Adopt, during the RC window, with four required amendments.** The design is sound: the optional deep brand is the only variant that survives member access without breaking structural seeds, the discriminated-union and tuple/optionality behavior checks clean, the readonly-array rejection catches a real and otherwise-invisible bug class, and the tooling story (checker-probeable anchor for lint/semantic tokens) is credible and demonstrated. The costs are front-loaded into exactly the period (2.0.0-rc) where breaking type changes are cheapest.

Amendments, in priority order:

1. **Ban `X | Store<X>` unions as a hard API rule** — in this repo and in the docs. Adopt the branch's ordered-overload pattern everywhere (`packages/signals/src/store/index.ts`, `next/projection.ts`, `next/optimistic.ts`, `packages/solid/src/server/signals.ts`, hydration wrappers), and add a type-test file locking the `this`-typed-getter literal shapes (plain form, derived typed, derived untyped) so the crash shape is pinned against future signature edits.
2. **File the tsc overflow upstream** with the minimal repro (deep homomorphic mapped type in a parameter union × `this`-typed getter literal). Document the userland hazard ("don't write `T | Store<T>` unions; use overloads") until it's fixed.
3. **Unbrand at the unwrap boundary**: fix `snapshot()` typing (sketch above) in the same change.
4. **Audit `keyof`-driven utilities once** (`merge`/`omit` `Override` types, `storePath` `KeyOf`) against branded inputs, and document the `keyof S & string` idiom.

Additionally recommended before stabilization (not blocking adoption): measure checker cost on a large consumer, and land the companion lint rule for the primitive-only residue — the brand was designed to be its anchor, and the residue is the one advertised catch it cannot make on its own.
