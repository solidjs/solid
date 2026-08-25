# AST-Native Rewrite Checkpoint

This branch restarts `@dom-expressions/compiler` as an AST-native compiler implemented with Oxc. The preserved string-splice research backend lives on local branch `research/oxc-string-backend`.

## Design Rules

- Mirror the Babel plugin pass/model structure as closely as Oxc allows.
- Parse once, mutate/build Oxc AST nodes, and codegen once.
- Use the current fixture knowledge as a behavior oracle, not as implementation architecture.
- Keep this checkpoint current after every completed subtask.

## Milestone 1: DOM Simple Path

- [x] Create checkpoint document.
- [x] Scaffold minimal package.
- [x] Implement AST-native DOM simple native elements/templates.
- [x] Implement AST-native dynamic text insertion.
- [x] Implement AST-native basic component lowering.
- [x] Pass focused tests for simple elements, dynamic text, and basic components.
- [x] Add focused Babel-source subsets for `simpleElements` and `textInterpolation`.
- [x] Replace generated expression/helper/template snippets with `AstBuilder` nodes for the milestone path.
- [x] Split the AST-native prototype into Babel-shaped `config`, `shared`, and `dom` modules.
- [x] Document production-hardening gaps and current supported scope.
- [x] Replace useful current string mini-IR with typed AST values for component children and DOM operations.
- [x] Add explicit unsupported-feature tests for features outside the milestone.
- [x] Add staged Babel fixture harness with full-source/subset classification.
- [x] Add checked-in Oxc outputs for supported Babel-source fixtures and parser-limited subsets.
- [x] Add `dom/attrs.rs` for static milestone DOM attribute template lowering.
- [x] Add first plain dynamic DOM attribute lowering through `effect` + `setAttribute`.
- [x] Add `shared/constants.rs` for the Babel/runtime constants used by the current DOM slice.
- [x] Add `dom/events.rs` for first updated-Babel event lowering slice.
- [x] Add Babel-aligned `omitLastClosingTag` / `omitNestedClosingTags` config for native DOM templates.
- [x] Expand `dom/textInterpolation` to full checked-in Oxc fixture coverage.

## Module Map

- `src/lib.rs` - public NAPI entrypoint, parse/codegen orchestration.
- `src/config.rs` - public transform options/result and filename source-type handling.
- `src/shared/ast.rs` - target-neutral AST construction helpers for imports, calls, object props/getters, variables, and argument conversion.
- `src/shared/transform.rs` - shared AST traversal and JSX expression dispatch for DOM, SSR, and universal targets.
- `src/shared/array.rs` - conversion helpers for generated array-expression elements.
- `src/shared/bindings.rs` - local binding collection used by static evaluation and ref decisions.
- `src/shared/component.rs` - component lowering orchestration for the current milestone.
- `src/shared/component_children.rs` - component JSX children lowering and child getter setup handling.
- `src/shared/component_props.rs` - component prop object, spread, and `mergeProps` assembly helpers.
- `src/shared/constants.rs` - Rust mirror of Babel/runtime constants and DOM close-tag element lists currently used by the Oxc DOM slice.
- `src/shared/fragment.rs` - fragment lowering for the current milestone.
- `src/shared/refs.rs` - component ref normalization helpers.
- `src/shared/statements.rs` - statement-level JSX setup lowering for variable initializers, returns, and class fields.
- `src/shared/this.rs` - `this` capture state and helper insertion.
- `src/shared/utils.rs` - shared JSX/tag/text/static-expression helper functions.
- `src/dom/attrs.rs` - DOM attribute orchestration, generic dynamic attributes, DOM refs, close-tag helpers, and static attribute serialization.
- `src/dom/children.rs` - native DOM child lowering, dynamic insert handling, and spread-child support.
- `src/dom/class.rs` - class/className/class-array lowering and classList toggle helpers.
- `src/dom/element.rs` - AST-native DOM native element orchestration.
- `src/dom/events.rs` - DOM event lowering, including delegated/native paths and array handler forms.
- `src/dom/ids.rs` - generated DOM/template/ref identifier helpers.
- `src/dom/properties.rs` - `prop:*`, child-property, and DOM state-property lowering.
- `src/dom/spread.rs` - DOM spread attribute lowering through `spread` / `mergeProps`.
- `src/dom/static_template.rs` - static native DOM template lowering.
- `src/dom/style.rs` - static/dynamic style object lowering and `style` / `setStyleProperty` helper paths.
- `src/dom/template.rs` - template registry, helper imports, template declarations, and shared `AstBuilder` construction helpers.
- `src/ssr/mod.rs` - SSR target module shell.
- `src/ssr/template.rs` - SSR template part/value accumulator used by native SSR lowering.
- `src/ssr/transform.rs` - SSR transform orchestration, component/native lowering, helpers, and import insertion.
- `src/universal/mod.rs` - universal target module shell.
- `src/universal/component.rs` - universal component callee/member identifier construction.
- `src/universal/helpers.rs` - universal AST helper wrappers for ids, calls, statements, imports, and IIFEs.
- `src/universal/transform.rs` - universal transform orchestration and native/component lowering.

## Current Status

Milestone 1 focused tests are green:

- simple native DOM element -> template call
- dynamic text child -> `insert`
- basic component -> `createComponent`
- full Babel `dom/simpleElements` fixture
- full Babel `dom/textInterpolation` fixture
- full Babel `dom/eventExpressions` fixture
- full Babel `dom/attributeExpressions` fixture
- full Babel `dom/SVG`, `dom/SVGComponentPartial`, `dom/conditionalExpressions`, `dom/customElements`, `dom/fragments`, `dom/insertChildren`, and `dom/multipleClassAttributes` fixtures
- full Babel `dom/components` fixture
- parseable `dom/namespaceElements` fixture sections, excluding Oxc parser-blocked hyphenated JSX member segments
- fixture-sourced Babel tests for every DOM fixture family the parser currently supports
- staged Babel fixture harness with full-source coverage for supported families and explicit subset coverage for parser-blocked `namespaceElements`
- generated Oxc output fixtures for supported Babel-source fixtures/subsets
- explicit unsupported-feature errors for non-DOM mode and non-`prop` namespaces
- focused static DOM attribute serialization coverage
- focused plain dynamic DOM attribute coverage
- focused DOM child-property attribute lowering for `textContent`, `innerHTML`, `innerText`, and `children`
- static style object template serialization for string/numeric/null/undefined entries
- dynamic style object property lowering through the runtime `setStyleProperty` helper
- dynamic style attribute lowering through `effect` and the runtime `style` helper
- dynamic `class` / `className` lowering through `effect` and the runtime `className` helper
- simple class object lowering through `classList.toggle`
- class array lowering for static string entries plus static/dynamic object entries, with unsupported array shapes falling back to `className`
- DOM state property lowering for `value`, `checked`, `selected`, `muted`, and default variants through property assignment/effects
- DOM ref lowering for function, identifier, call-expression, static-member, simple optional-member, conditional, and nullish refs through `ref` plus assignment fallback where valid
- DOM `prop:*` attributes lowered as one-time property assignments
- known namespaced DOM attributes such as `xlink:href` lowered through `setAttributeNS`
- constants-backed coverage for void elements, child properties, and DOM state properties
- Babel-aligned last closing-tag omission for native DOM templates
- focused event coverage for delegated inline handlers, native inline handlers, and rejected `on:` namespaced events
- full event fixture coverage for native handlers, delegated handlers, array data handlers, `addEvent`, and `delegateEvents`
- text-only fragment lowering and text/entity handling for component and fragment children
- native/component spread child lowering for the full `insertChildren` fixture
- placeholder marker anchors for dynamic text runs surrounded by static text
- narrow static binding evaluation for `textInterpolation` literals and `+` expressions
- DOM/component attribute entity handling for `textInterpolation`
- graceful unsupported handling for broader generated expressions in attribute fixture probes
- component prop getters for member-expression props and `@static` opt-out
- component child getters for dynamic member/array/JSX children
- component spread props with `mergeProps`, including dynamic spread thunking
- DOM spread attributes through `spread` / `mergeProps`
- component identifier, static-member, simple optional-member, and call-expression refs normalized with `applyRef` fallback
- component child getter setup statements lowered without nested IIFEs
- `builtIns` option for configured component imports such as `For` and `Show`
- JSX member / `this` component callee construction for supported expression contexts
- `this` capture for component prop/child expressions inside supported class method and field JSX
- SSR mode skeleton for static native elements/text through the runtime `ssr` helper
- full Babel `ssr/simpleElements` fixture coverage for the supported SSR slice
- SSR dynamic text interpolation through the runtime `escape` helper
- Babel `ssr/textInterpolation` fixture subset coverage for native-element text/attribute cases
- SSR plain dynamic native attributes through `escape(..., true)`
- full Babel `ssr/attributeExpressions` fixture coverage
- shared component prop assembly now drives both DOM and SSR component emitters
- full Babel `ssr/components` fixture coverage
- full Babel `ssr/SVG`, `ssr/conditionalExpressions`, `ssr/customElements`, `ssr/duplicateAttributes`, `ssr/fragments`, `ssr/insertChildren`, and `ssr/multipleClassAttributes` fixture coverage
- Babel `universal/simpleElements` fixture coverage for static native elements/text/attributes
- universal dynamic text insertion through `insert`
- Babel `universal/textInterpolation` fixture subset coverage for native-element cases
- universal component calls using shared prop/spread/getter assembly
- full Babel `universal/components` fixture coverage
- full Babel `universal/attributeExpressions` and `universal/insertChildren` fixture coverage
- full Babel `dynamic` fixture coverage, including hybrid DOM/universal renderer dispatch
- full Babel `dom-hydratable` fixture coverage through `getNextElement` template roots
- full Babel `dom-hydratable-dev` fixture coverage through validation-aware `getFirstChild` / `getNextSibling` walks
- full Babel `ssr-hydratable` fixture coverage through root `ssrHydrationKey` template splits

The first Rust implementation uses `VisitMut` to replace JSX expression nodes and prepends helper imports/templates as AST statements before a single Oxc codegen pass.

Checkpoint: generated milestone expressions, helper imports, and template declarations are now built directly with `AstBuilder`; snippet parsing has been removed from the current milestone path. Source maps are enabled and covered by a focused test.

The prototype is now split into the first Babel-shaped module layout. DOM attributes are dispatched from `dom/attrs.rs` into focused modules for class, style, property, and spread lowering. Native static template lowering lives in `dom/static_template.rs`, child insertion in `dom/children.rs`, event paths in `dom/events.rs`, and helper/template assembly in `dom/template.rs`. The Oxc slice now mirrors the Babel/runtime constants and close-tag element lists it actively uses through `shared/constants.rs`.

Refactor acceptance checks completed:

- `shared/transform.rs` owns the shared `VisitMut` traversal implementation across DOM, SSR, and universal targets.
- `shared/component.rs` owns `lower_component`.
- `dom/template.rs` owns `prepend_helpers`, helper imports, template declarations, and shared AST construction helpers.
- `dom/element.rs` no longer owns component lowering or template/helper assembly implementation.
- Fixture-sourced tests are intentionally limited to the implemented surface; broader fixture families should be enabled only as the corresponding pass is ported.

Fixture harness acceptance checks completed:

- Every Babel DOM fixture is classified.
- `simpleElements`, `textInterpolation`, `attributeExpressions`, `components`, `SVG`, `SVGComponentPartial`, `conditionalExpressions`, `customElements`, `fragments`, `insertChildren`, and `multipleClassAttributes` have checked-in Oxc output fixtures generated from full Babel sources.
- `namespaceElements` has checked-in Oxc output for the parseable sections; hyphenated JSX member segments remain blocked before transform by the current Oxc parser.
- `UPDATE_OXC_FIXTURES=1` refreshes those checked-in Oxc outputs when supported fixture output intentionally changes.
- No Babel DOM fixture family is fully unclassified/unsupported in the harness; `namespaceElements` is the only parser-limited subset.

## Architecture Parity Audit

This audit checks whether the compiler still follows the Babel plugin shape and remains a production-grade AST transform.

What still matches the intended architecture:

- The compiler parses once with Oxc, mutates/builds AST nodes, and codegens once. There is no generated-code parsing or output string splicing in the transform path.
- Generated expressions, statements, imports, object properties, helper calls, and template declarations are built with Oxc AST nodes.
- The high-level module families mirror Babel's shape: shared traversal in `shared/transform` dispatches into target-specific DOM, SSR, and universal lowering modules.
- Helper import ownership is centralized in `dom/template.rs` through `DomTemplateState`, which is the right equivalent to Babel's `registerImportMethod` plus postprocess import insertion.
- Runtime/Babel constant mirrors live in `shared/constants.rs` instead of being duplicated inline across passes.
- The fixture harness clearly distinguishes Oxc output fixtures from Babel byte-for-byte golden output. It uses Babel fixture sources as the behavior oracle and locks generated Oxc output for supported slices.

Refactor follow-up completed:

- `shared/transform.rs` now owns traversal dispatch only; binding collection, statement-level setup lowering, and `this` capture helpers have been split into `shared/bindings.rs`, `shared/statements.rs`, and `shared/this.rs`.
- Component helper logic has been split into `shared/component_children.rs`, `shared/component_props.rs`, and `shared/refs.rs`, leaving `shared/component.rs` as the component-lowering orchestrator.
- Static native DOM template lowering moved from `dom/attrs.rs` to `dom/static_template.rs`, and feature-specific DOM attribute lowering is split across `dom/class.rs`, `dom/style.rs`, `dom/properties.rs`, and `dom/spread.rs`.

Architectural drift still to address before broadening much further:

- `dom/element.rs` is now orchestration-focused; native child/template assembly and generated id helpers live in `dom/children.rs` and `dom/ids.rs`.
- Template strings are assembled as template payload strings. This is not output string-splicing, but it is still a milestone-only template IR. As attributes, SVG/MathML, raw text, hydration markers, and namespace handling expand, this should become a typed template model rather than scattered `push_str` calls.
- `source_from_span` is still used for `@static` detection. That is source inspection, not AST output splicing, but production parity should prefer AST/comment metadata once the Oxc APIs are wired in.
- Static evaluation and binding classification are narrow fixture-oriented approximations. They are useful for parity progress, but they are not a replacement for semantic analysis.
- Generated-expression conversion helpers cover the current Oxc expression surface used by this compiler path.

Current production blockers:

- Full semantic binding analysis for refs, static evaluation, namespace imports, and dynamic detection.
- Complete component ref normalization parity, including computed optional refs, nested optional refs, calls in all contexts, and precise const/import/function binding behavior.
- Full `transformThis` parity across nested generated getters, function parents, class methods, class fields, and top-level/no-parent cases.
- DOM namespace parity for unknown/custom namespaced attributes and any namespace semantics beyond currently mirrored runtime constants.
- `namespaceElements` full fixture support is parser-blocked for JSX member segments containing hyphens (`<module.a-b />`) in the current Oxc parser.
- Event parity for binding-resolution optimizations and any custom/non-delegated cases not represented in current checked fixtures.
- Typed template IR for complex DOM templates, including raw-text elements, SVG/MathML wrappers, hydration markers, and precise placeholder walking.
- Universal coverage beyond the currently checked fixture families.
- Source-map coverage for each new pass as it is ported.

## Supported Scope

Current AST-native compiler supports:

- DOM, SSR, universal, and dynamic output modes
- hydratable DOM and hydratable SSR output modes
- dev hydratable DOM validation walks for dynamic native child setup
- simple native JSX elements
- static string/boolean/numeric/null JSX expressions in templates
- Babel-style closing-tag omission via `omitLastClosingTag` and `omitNestedClosingTags`
- plain dynamic DOM attributes lowered through `effect` + `setAttribute`
- inline function event handlers: delegated handlers use `$$event` plus `delegateEvents`, native handlers use `addEventListener`
- event array handlers and unresolved delegated/native handlers lowered through Babel-aligned `addEvent` / delegated event paths
- dynamic text children lowered through `insert`
- spread children lowered through `insert` / component children
- `<!>` placeholder markers for multi-expression text runs that need stable insertion anchors
- simple static binding evaluation for literal `+` expressions in templates
- DOM static attribute entity decode plus expression attribute escaping
- component prop getters for member-expression props and component child getters for dynamic member/array/JSX children
- component spread props via `mergeProps`
- DOM spread attributes via `spread` / `mergeProps`
- component identifier, static-member, simple optional-member, and call-expression refs normalized with `applyRef` fallback
- DOM function, identifier, call-expression, static-member, simple optional-member, conditional, and nullish refs lowered through `ref` plus assignment fallback where valid
- DOM `prop:*` attributes lowered as one-time property assignments
- known namespaced DOM attributes lowered through `setAttributeNS`
- dynamic style object properties lowered through `setStyleProperty`, with reactive expressions wrapped in `effect`
- class arrays with static string entries plus static/dynamic object entries lowered through template class folding and `classList.toggle`; broader array entries fall back to `className`
- return-statement JSX with setup lowered without an outer IIFE
- `builtIns` component import rewriting for configured names
- JSX member / `this` component names in supported expression contexts
- `this` capture for component prop/child expressions in supported class method and field JSX
- text-only fragments lowered to strings, expressions, or arrays
- basic component calls lowered through `createComponent`
- source maps for the implemented path
- SSR mode for static native elements/text in the `simpleElements` fixture
- SSR dynamic text interpolation and static/dynamic native attribute text in the supported `textInterpolation` subset
- full Babel `ssr/attributeExpressions` fixture coverage, including native spreads and fragments
- full Babel `ssr/components` fixture coverage through shared prop/spread/getter assembly and SSR `this` capture
- full checked-in coverage for every Babel SSR fixture family currently in the repo
- universal mode for static native elements/text/attributes in `simpleElements`
- universal dynamic text insertion in the supported `textInterpolation` subset
- full Babel `universal/components`, `universal/attributeExpressions`, and `universal/insertChildren` fixture coverage
- full Babel `dynamic` fixture coverage, including DOM-renderer and universal fallback modes
- Babel `dom-no-inline-styles/attributeExpressions` fixture coverage for `inlineStyles: false`
- Babel-aligned `memo` predicate lowering for DOM conditional children and component props in checked DOM/hydratable/dynamic condition fixtures
- Babel-aligned fragment and component child array `memo` wrapping for dynamic expressions
- Babel-aligned DOM child expression wrapping for dynamic member, call, optional, nullish, and nested-JSX expressions
- component children with optional chains and nested fragment conditionals now use Babel-shaped getters, memo wrappers, and empty-fragment arrays
- Babel `dom-wrapperless` fixture coverage for paired `wrapConditionals: false` / `memoWrapper: false` mode
- hydratable delegated DOM events replay queued events through `runHydrationEvents`
- computed-member DOM refs include Babel's non-callable assignment fallback
- dynamic hybrid mode avoids duplicate local helper imports when DOM and universal helpers share helper names
- hydratable SSR child slots defer later hydration-id allocating children after deferred children, matching the latest Babel ordering fix
- public README and TypeScript declarations reflect the current compiler modes and option surface

## Config Option Audit

Supported Oxc compiler options:

- `filename`, `moduleName`, `generate`, `hydratable`, `dev`, `sourceMap`
- `builtIns`
- `contextToCustomElements`, defaulting to the Solid-compatible `true` baseline
- `delegateEvents` and `delegatedEvents`
- `omitQuotes` and `omitAttributeSpacing`
- `inlineStyles`
- `effectWrapper: false` for DOM dynamic setter paths
- paired `wrapConditionals: false` / `memoWrapper: false` wrapperless mode
- `requireImportSource`
- `staticMarker`
- `validate` accepted as an output-preserving validation toggle
- `omitNestedClosingTags` and `omitLastClosingTag`
- `renderers` for the supported dynamic `dom` renderer override

Babel options accepted only at default values because they do not change output from the current Oxc baseline:

- `memoWrapper: "memo"`

Non-default values for those Babel options now throw before native option conversion rather than being silently ignored. Unknown top-level options and unknown dynamic renderer entry fields also throw.

`wrapConditionals: false` and `memoWrapper: false` are supported together as wrapperless mode. Unpaired use remains intentionally rejected because Babel's behavior for those options is coupled.

## Readiness Audit

Coverage inventory:

- Checked Oxc fixture suites cover DOM, DOM hydratable, DOM hydratable dev, DOM no-inline-styles, DOM wrapperless, SSR, SSR hydratable, universal, dynamic DOM/universal, and dynamic universal fallback modes.
- Babel fixture directories not represented as dedicated Oxc fixture directories are covered by focused option tests where the behavior is localized: `requireImportSource`, compatible quote/spacing options, and numbered id handling.
- `namespaceElements` remains a parser-limited DOM subset because Oxc currently rejects hyphenated JSX member segments before transform.

Must-fix before Solid-consumable status:

- No known must-fix parity blockers from the latest readiness probes.

Acceptable limitations for an initial experimental release:

- Unknown/custom namespaced DOM attributes still throw except for known runtime namespaces such as `xlink`.
- Custom `effectWrapper` / `memoWrapper` function names are not supported; `effectWrapper: false` and paired wrapperless mode are supported.
- Dynamic renderer config supports the `dom` renderer override plus universal fallback, but not arbitrary custom renderer names beyond that path.

Production hardening still needed:

- Replace source-span marker detection with structured comment metadata.
- Replace narrow binding/static/dynamic approximations with semantic analysis.
- Finish edge-case ref normalization, especially computed optional refs and binding-sensitive assignment decisions.
- Revisit `this` capture across deeper nested generated getters/functions.
- Replace milestone string-template assembly with a typed template model before broadening raw-text/SVG/MathML/hydration marker work further.

Unsupported features intentionally throw:

- SSR features beyond current native/component attribute/text/spread/namespace support
- universal features beyond currently checked fixture coverage
- unsupported special dynamic DOM attributes such as unknown namespaced attributes and advanced property forms
- event binding-resolution optimizations not represented by current fixture coverage
- full Babel-style component ref normalization for computed optional refs, nested optional refs, and complete semantic binding analysis
- complete Babel `this` capture semantics outside currently fixture-covered class method/field contexts
- `namespaceElements` fixture sections that require parsing hyphenated JSX member segments
- unknown namespaced attributes
- non-default Babel config options outside the audited supported surface
- unpaired `wrapConditionals: false` or `memoWrapper: false`

## Production-Hardening Gaps

Before production status:

- Replace source-span comment inspection (`@static`) with AST/comment metadata once Oxc exposes a suitable API in this path.
- Replace narrow binding/static/dynamic approximations with semantic analysis.
- Decide whether parser-blocked `namespaceElements` should be handled upstream in Oxc parser configuration or remain documented as unsupported.
- Replace current milestone-only template-string assembly with a typed template IR when attributes/children become more complex.
- Preserve source-map coverage as each new pass is added.

Last verification:

- `pnpm --filter @dom-expressions/compiler test`
- `pnpm --filter @dom-expressions/compiler lint`

