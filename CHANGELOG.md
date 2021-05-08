# Changelog

## 0.26.0 - 2021-04-09

This release is about finalizing some API changes on the road to 1.0. This one has one breaking change and not much else.

#### Signals no longer always notify by default

Solid's original behavior has been to always notify on signal change even if the value hasn't changed. The idea was to simulate stream behavior. However, this has some downsides:

1. Inconsistent with State.. I made the decision to make state equality check by default, it is weird signals and memo's do not.
2. More likely to hit infinite loops. Equality check naturally stops infinite loops in some cases. While infinite loops aren't good and code that produces them suspect, it is nice to keep things clean.
3. It is consistent with other modern reactive libraries like MobX and Vue.

The API has not changed. You can opt out of the default behavior by passing in your own comparator or false to the 2nd parameter of `createSignal` and the 3rd parameter of `createMemo`.

My hope this is the last release before I start making 1.0 RC's. This one has big enough impact I want to get this out first. I imagine the remaining changes will be just syntax.

## 0.25.0 - 2021-03-28

This release is about refining the the APIs as we approach the our release candidate for 1.0.

### Breaking Changes

#### Resource API

Minor difference to allow the first argument to be optional and support more features in the future. New full signature is:

```ts
export function createResource<T, U>(
  fn: U | false | (() => U | false),
  fetcher: (k: U, getPrev: () => T | undefined) => T | Promise<T>,
  options?: { initialValue?: T }
): ResourceReturn<T>;
```

3rd argument is now an options object instead of just the initial value. This breaking. But this also allows the first argument to be optional for the non-tracking case. Need a promise that only loads once? Don't have need to re-use the fetcher. Do this:

```js
const [data] = createResource(
  async () => (await fetch(`https://someapi.com/info`)).json()
);
```

#### on/onCapture

These are an escape hatch for unusual events. Previously these were custom attributes but now they are namespaced like:
```jsx
<div on:someUnusualEvent={e => console.log(e.target)} />
```

#### change `main` field to be node

Now that we are supporting SSR for legacy(non-ESM) systems I need to use the main field to indicate a node env. We will be using the "browser" field for the client build in Solid. This straight up breaks Jest which doesn't respect that. I've created `solid-jest` to handle this.

https://github.com/solidui/solid-jest

### New Features

#### Namespace Types
Types added for Namespace attributes. You probably won't need most of these because they are for more advanced usage. However to use them you need to extend the JSX Namespace:

```ts
declare module "solid-js" {
  namespace JSX {
    interface Directives {  // use:____

    }
    interface ExplicitProperties { // prop:____

    }
    interface ExplicitAttributes { // attr:____

    }
    interface CustomEvents { // on:____

    }
    interface CustomCaptureEvents { // oncapture:____

    }
  }
}
```

#### Lazy component preload
Lazy components now have a preload function so you can pre-emptively load them.
```js
const LazyComp = lazy(() => import("./some-comp"))

// load ahead of time
LazyComp.preload();
```

#### Error Boundary reset
Error boundaries now have the ability to reset themselves and try again. It is the second argument to the fallback.

```js
<ErrorBoundary fallback={(err, reset) => {
  if (count++ < 3) return reset();
  return "Failure";
}}><Component /></ErrorBoundary>
```

## 0.24.0 - 2021-02-03

This release is the start of the rework of the SSR solution. Consolidating them under a single method. Unfortunately this one comes with several breaking changes.

### Breaking Changes

#### Removed `solid-js/dom`

It's been a few versions deprecated. It's gone.

#### Updated Resource API

Changed to more resemble SWR and React Query. Needed to remove `createResourceState`so now need to use a getter over `createResource` to get same effect. See updated documentation.

#### Change SSR render call signatures

They now return results objects that include the generated hydration script. No more need to generate it separately. Also comes autowrapped in the `script` tag now.

#### `assignProps` to `mergeProps`

While you use them the same way mostly it no longer has `Object.assign` semantics and always returns a new object. This is important as in many cases we need to upgrade to a Proxy.

#### Renamed `getContextOwner` to `getOwner`

Removes confusion around context and consistent with new helper `runWithOwner`.

#### Solid Element no longer uses State for props

This reduces the size of the library especially for those not using state. It also should slightly increase performance as no need for deep nesting of proxies. It also makes things behave more consistently avoided unintended deep wrapping.

### Non-breaking Changes

#### New non-reactive Async SSR

I have now combined sync/streaming/async SSR into the same compiler output. To do so I have developed a new non-reactive Async SSR approach. After realizing how fast Solid renders, it occurred to me on the server we could do a much simpler approach if we were willing to re-render all content in Suspense boundaries. While that is some wasted work, compared to including the reactive system it's a killing.

#### Increase SSR Performance

Through reusing static strings in the template we reduce repeated creation costs. This small improvement can make 5-8% improvements where you have many rows.

#### Event Delegation

Solid is now being more strict on what events it delegates. Limiting to standard pointer/touch/mouse/keyboard events. Custom events will no longer be delegated automatically. This increases compatibility for Web Component users who don't compose their events. Non-delegated events will still work and binding array syntax with them.

#### State getters no longer memos

Automatic memos put some constraints on the disposal system that get in the way of making the approach flexible to hold all manner of reactive primitives. Some previous limitations included not being able to have nested getters. You can still manually create a memo and put it in a getter but the default will not be memoized.

### New Features

#### `children` helper

Resolves children and returns a memo. This makes it much easier to deal with children. Using same mechanism `<Switch>` can now have dynamic children like `<For>` inside.

#### "solid" Export Conidition

This is the way to package the JSX components to be compiled to work on server or client. By putting the "solid" condition the source JSX will be prioritized over normal browser builds.

### Bug Fixes

- Top level primitive values not working with `reconcile`
- Fix Dynamic Components to handle SVG
- Rename potentially conflicting properties for event delegtion
- Fixed State spreads to not loose reactiviy. Added support for dynamically created properties to track in spreads and helpers
- TypeScript, always TypeScript

## 0.23.0 - 2020-12-05

This release is mostly bug fixes. Breaking change for TS users. JSX types no longer pollutes global namespace. This means you need to update your projects to import it.

For users TS 4.1 or above add to your tsconfig to have JSX types in all your TSX files:

```js
"compilerOptions" {
  "jsx": "preserve",
  "jsxImportSource": "solid-js",
}
```

Or mixing and matching? You can set JSX types per file using the pragma at the top of each file:

```js
/* @jsxImportSource solid-js */
```

You can now import `JSX` types directly from Solid as neccessary:

```js
import { JSX } from "solid-js";
```

## 0.22.0 - 2020-11-14

### Unified Exports (Deprecation `solid-js/dom`)

Solid now has streamlined exports for isomorphic development. This means from now on using `solid-js/web` instead of `solid-js/dom`. Based on compiler options it will swap out the appropriate packages for web. You should only ever import `solid-js`, `solid-js/h`, `solid-js/html`, and `solid-js/web` directly in your code.

`solid-js/web` now exports an `isServer` field which indicates whether the code is executed for server rendering. This is constant in the respective packages meaning it can allow for powerful treeshaking/dead code elimination in final bundles even when used directly in end user code or 3rd party libraries.

### Dev Mode

Aliasing `solid-js` to `solid-js/dev` in your bundler links in a Dev mode of Solid. It's still a WIP process but it introduces some new APIs. First signals and state (and resources) have the ability to set a name for debug purposes as an options argument.

We also export a `serializeGraph` method which will serialize all the signals below the executing context in the reactive graph.

Finally there is a new `globalThis._$afterUpdate` hook that can be assigned that will be called after every render that can be used for tracking purposes.

This is just the start but it is my intention to develop these features to allow for better HMR and DevTools.

> Note: If the libraries are not being pulled into your bundle and are treated as external you may need to alias `solid-js` to `solid-js/dev` in your bundler in order to use dev mode.

### Self contained HyperScript/Lit Modules

We now ship the respective DOM expressions code. This makes it much easier to use directly from a CDN like Skypack. You literally can develop with Solid in the old school write it in notepad before npm was a thing sort of way.

```html
<html>
  <body>
    <script type="module">
      import { createSignal, onCleanup } from "https://cdn.skypack.dev/solid-js";
      import { render } from "https://cdn.skypack.dev/solid-js/web";
      import html from "https://cdn.skypack.dev/solid-js/html";

      const App = () => {
        const [count, setCount] = createSignal(0),
          timer = setInterval(() => setCount(count() + 1), 1000);
        onCleanup(() => clearInterval(timer));
        return html`<div>${count}</div>`;
      };
      render(App, document.body);
    </script>
  </body>
</html>
```

Save this in a text file called "site.html" and double click it and instant Solid in your browser.

### renderToWebStream

New `renderToWebStream` for synchronous SSR mode. This allows us to stream from things like Cloudflare Workers.

### createMutable

New mutable state primitive. Useful for interopt with other libraries. We can use this potentially for things like Vue/MobX compat. Or when we need to interact with libraries that can't be aware of Solid's reactive system, yet we want to capture updates. It supports getters and setters.

Use with caution as it can promote difficult to reason about code, anti-patterns, and unexpected performance cliffs. Keep in mind Vue and MobX care less about these inefficient patterns since they have a VDOM safety net. We do not. For advanced users only.

```js
const user = createMutable({
  firstName: "John",
  lastName: "Smith",
  get fullName() {
    return `${this.firstName} ${this.lastName}`;
  },
  set fullName(value) {
    const parts = value.split(" ");
    batch(() => {
      this.firstName = parts[0];
      this.lastName = parts[1];
    });
  }
});
console.log(user.fullName); // John Smith
user.fullName = "Jake Murray";
console.log(user.firstName); // Jake
```

### State Getter/Setters are now Wrapped

Getters are now wrapped in `createMemo` and setters in `batch`. However, this introduces a new limitation that they can only be top level to have this behavior.

### State compatible with Prop Helpers

You can now use state with `assignProps` and `splitProps` helpers.

### Removed DOM SSR

No longer supporting hydratable DOM SSR in patched(ie... JSDOM) node environments. Use the standard SSR methods instead. Can still run Solid in JSDOM for things like Jest, but can't be used for isomorphic development.

## 0.21.0 - 2020-10-17

### Attribute and Prop changes

We will now default to using Attributes where possible to be consistent. Solid is aiming to generally reflect the case insensitiveness of HTML. Custom Elements remain the one place that defaults to property setters on Dynamic elements.

While TypeScript 4.2 is yet to be released, we are introduce `attr`, `prop`, `use` and `style` namespace directives. To allow more expressiveness in binding syntax.

### Other Changes

- New `on` and `onMount` helpers
- More performant SSR escaping
- Lazy eval SSR Component props (fix SSR Context API)
- Add support for SSR with Solid Styled Components
- Fix Lit Dom Expressions style in Template tags
- Fix JSX Types

## 0.20.0 - 2020-09-24

### Re-scheduling Reactivity.

This release makes large changes to the Reactive System. Key changes are deferring `createEffect` to be after rendering and introducing `createComputed` do reactive graph updates like loading async data.

### Concurrency

In addition the the reactive model brings updates to Suspense and Transitions. Solid now has true concurrent rendering at a granular level. This mechanism does differ from React as it currently only supports a single future.

### Removed APIs

`afterEffects`, `createDependentEffect`, and `suspend` have been removed as they no longer make sense with the new reactive system timing.

## 0.19.0 - 2020-08-23

API Changes to support better SSR

### Breaking Changes:

#### Set State

Mutable form is no longer a default. It was strangely inconsistent as you could accidentally mutate in immutable forms. No indicator why it should behave differently and work. Increased the size of `state` for everyone and added performance overhead with additional proxy wrapping. Also it was based on returning undefined meaning function forms could never return undefined to blank a vlue. Solid has changed it into a state setter modifier `produce` after ImmerJS naming.

```js
// top level
setState(produce(s => (s.name = "John")));

// nested
setState(
  "user",
  produce(s => (s.name = "John"))
);
```

#### Prop APIs

After writing `setDefaults`, `cloneProps`, and about to introduce `mergeProps` it became clear we can do this all with a single `assignProps` helper. So the former has been removed and now we have:

```js
// default props
props = assignProps({}, { name: "Smith" }, props);

// clone props
newProps = assignProps({}, props);

// merge props
assignProps(props, otherProps);
```

It follows the same pattern as ES `Object.assign` adding properties to the first argument and returning it. Except this method copies property descriptors without accessing them to preserve reactivity.

#### `freeze` & `sample` have been renamed

These APIs never had the most obvious naming, borrowing from SRP and digital circuit concepts rather than common english. They are now `batch` and `untrack` respectively which better reflect their purpose. These are now deprecated and will be removed in next minor version.

#### Resource API

For better automatic hydration support it is prudent to change resource signatures to take functions that return promises rather than promises themselves. This factory function has a lot advantages. This allows the library to decide whether to execute it or not. In certain cases we can choose skipping creating the promise altogether. It also leaves the door open for things like retry.

We use this mechanism to wire up streamed data from the server and automatic data hydration for resources rendered into the page in async SSR.

#### SSR Improvements

New experimental support for Suspense aware synchronous, asynchronous, and streaming SSR with hydration, progressive hydration, and automatic isomorphic data serialization. Completely removed what was there before with a simple static generator and more examples, so all existing projects using `solid-ssr` package will break with this release. This is a much better foundation, and I hope to build better things on top.

### New

#### State Getters

For convenience of passing derived values or external reactive expressions through Solid's state initializer you can now add `getter`'s.

```jsx
const [state, setState] = createState({
  firstName: "Jon",
  lastName: "Snow",
  get greeting() {
    return `You know nothing ${state.firstName} ${state.lastName}`;
  }
});

return <div>{state.greeting}</div>;
```

#### Control Flow

Dynamic allows swapping Component dynamically.

```jsx
// element tag name
const [comp, setComp] = createSignal("h1");

<Dynamic component={comp()} {...otherProps} />;

// Component
setComp(MyComp);
```

ErrorBoundary catches uncaught downstream errors and shows a fallback.

```jsx
<ErrorBoundary fallback={<div>Something went terribly wrong</div>}>
  <MyComp />
</ErrorBoundary>
```

#### Portals render in the Head

You can now render portals in the head with no additional div element.

#### Multi-version detection

Common hard to track issue with Solid is when multiple versions of the library are running on the same page. It breaks reactivity, and is sometimes difficult to notice. Solid now detects if a version has already been loaded at runtime and complains.

### Bug Fixes & Updates

Arguably a new feature but Solid now detects computation owners with pending dependency changes when trying to resolve nested computations. In so it will resolve those dependencies first. This fixes a long time issue with conditional processing with not directly related reactive atoms.

Improved TypeScript Types.

## 0.18.0 - 2020-05-01

A lot of bug fixes, and introduction of string based SSR.
Breaking Changes:

- Removal of `forwardRef`. Value and function handled by just `ref`.
- Change to how TypeScript is managed. Brought all JSX types inside the repo, and improved Component typing.
- Changed default renderer in `solid-ssr` to string renderer.

## 0.17.0 - 2020-03-24

A lot of consolidation in preparation for release candidate

- Big refactor of core reactive system and render list reconciler
  - Significantly smaller reducing core by atleast 3kb minified
- Better handling of nested reactive nodes in Fragments
- Update SSR mechanisms, added progressive event hydration, created repo for SSR environment (`solid-ssr`)
- `@once` compiler hint to statically bind values
- Better wrapping hueristics for booleans and ternaries in JSX

Breaking Changes

- Removed `transform` prop from control flow. Idiomatic approach is to make a HOC for transformations of this nature.
- Removed selectWhen/selectEach control flow transforms.
- Changed event system
  - `on____` prop to stop differentiating on case. Super confusing.Instead will try to delegate unless unable. Made TypeScript all CamelCase (although technically both forms behave identically)
  - Removed `model` event delegation approach. Instead to create bound event use array: `onClick={[handler, row.id]}`. Inspired by Inferno's `linkEvent` helper.
  - Renamed `events` prop to `on` prop
  - Added `onCapture` prop for capture events

## 0.16.0 - 2020-01-14

Big changes to experimental features:

- New resource API `createResource` and `createResourceState` to replace `loadResource`. These are built to prioritize read capabilities and simplify implementation.
- Support for Async SSR `renderToString` now returns a promise. Uses Suspense to know when it is done.
- Progressive Hydration with code splitting support. Ability to track events and replay as hydration completes to reduce "uncanny valley". Components can be lazily loaded even during hydration. **No support for async data on hydration yet**, so render it from server and load into state synchronously.
- New error boundary api with `onError`. If an error occurs in context or child context the nearest handler/s will be called.
- Deprecating the `force` `setState` modifier as it is confusing.

## 0.15.0 - 2019-12-16

A lot fixes and new features:

- Suspense improvements: `SuspenseList`, `useTransition`, trigger on read. Update API, and added `reload` and retry capability. Removed need for `awaitSuspense` by making `Show` and `Switch` control flows `Suspense` aware.
- Deprecate `selectWhen` and `selectEach`.
- Untrack all Components. No more fear of nesting Components in JSX expressions. Top level in a Component will always be inert now.
- Support for safe boolean and logical operators. This allows for the same optimization as the `Show` control flow for simple inline JSX conditionals like `<div>{state.count > 5 && <MyComp />}</div>`.
- Support for non-curried operator forms. All operators now support an accessor first form as well as the functional curried form. Ex `map(() => state.list, item => item)`
- Fix issues with spreading over `children` props.
- Better Type Definitions.

## 0.14.0 - 2019-11-16

v0.14.0 brings changes to the render runtime and `setState` API

- Adds diffing to batched computations to improve update performance
- Supports support for mutable(TypeScript safe) `setState` API inspired by Immer. Function setters in Solid now pass a mutable version of state. Modifying will schedule updates. This form must not return a value. It can still be used immutably simply by returning the new value.
- Changes how `force` and `reconcile` helpers work. They can now be used on nested paths.
- Removes support for multi-path `setState`.

## 0.13.0 - 2019-10-27

v0.13.0 contains large changes to the reactive system and compiler.

The main update is to simplify reactivity by removing computation recycling. While this was a useful feature to avoid unnecessary computation nodes, Solid now uses batching as a different approach to get similar results. Most templating libraries can offer breakneck update speeds without fine grained updates. The real cost of these top down approaches is the need to redo structural reconciliation. The current approach is that different computations will be created for each:

- Dynamic insert expression (any expression between tags)
- Spread operator
- JSX template entry point(Top level tag, Fragment, or Component Children)

To aid in performance simple text inserts the `textContent` binding is now optimized so they can be batched.

In addition there are some improvements to template cloning and SVG handing in SSR.

## 0.12.0 - 2019-10-18

v0.12.0 contains a breaking change to the reactive rendering system

- Removal of explicit dynamic binding, bindings will default to reactive unless impossible to be so (literal, function declaration, simple variable)
- SVG Camelcase attribute Support
- Prettier now supported!

## 0.11.0 - 2019-09-27

v0.11.0 continues to add updates to the reactive system as well as some new features:

- Fix reactivity resolution ordering on downstream conditionals
- Add basic (non-namespaced) SVG support
- Add experimental Server Side Rendering and Client Side Hydration capabilities
- Add Suspense aware control flow transformation (`awaitSuspense`)
- Allow state objects to track functions
- More TypeScript definition improvments and fixes

## 0.10.0 - 2019-08-11

v0.10.0 makes significant changes to the reactive system. Key updates:

- Fixed synchronicity on all hooks/control flows.
- Adds the ability to use comparators on `createMemo`.
- Fixes bugs with nested control flows.
- Fixes bugs with Suspense.
- Update Suspense `delayMs` to `maxDuration` to match React. (Usage of `maxDuration` still experimental)

## 0.9.0 - 2019-07-20

v0.9.0 makes signifigant changes to underlying reconciler.

- New Control Flow
- Removes Custom Directives
- New Functional Operators

## 0.8.0 - 2019-06-14

v0.8.0 brings further improvements in reducing bundle size and optimizations in reactivity. New Features:

- Universal loadResource API
- afterEffects hook
- Switch Control Flow

## 0.7.0 - 2019-05-25

v0.7.0 brings further improvements in tree shaking, Context API including Provide control flow, and suspense helpers for loading Async Components and Data.

This is a breaking change as in order to support this version, Solid has forked S.js the underlying library and now ships with it built in. This means Solid will no longer be compatible other S.js libraries. It is a turning point but enables the powerful new features.

## 0.6.0 - 2019-05-07

v0.6.0 brings a Tree Shakeable runtime. This means when Solid used with JSX the compiler can intelligently only include the code that is being used.

This is a breaking change in that:

- No longer need to import 'r' and selectWhen and selectEach directives have been moved to solid-js from solid-js/dom. You should not need to import from 'solid-js/dom' directly anymore as your compiled code will do it automatically.
- HyperScript and Lit imports have been made the default import now.. ex:

```js
import html from "solid-js/html";
```

- Tidied up the compiled template code. This should make it much nicer to debug when not minified.

## 0.5.0 - 2019-04-14

- Add support for multiple renderers (JSX, Tagged Template Literals, HyperScript). Added direct imports or 'solid-js/dom' alternatives 'solid-js/html' and 'solid-js/h'.
- Reorganized dependencies work.

## 0.4.2 - 2019-03-18

- Add fallbacks for control flow
- Add new Portal Control Flow - This allows nodes to be rendered outside of the component tree with support for satelite ShadowRoots.
- Add new Suspend Control Flow - This renders content to a isolated document and display fallback content in its place until ready. Good for nested Async Data Fetching.
- Default node placeholders to comments (improved text interpolation)
- Added events binding for irregular event names

## 0.4.0 - 2019-02-16

- Rename API to create\_\_ to be semantically correct
- Added implicit event delegation

## 0.3.8 - 2019-01-31

- Add support for HyperScript

## 0.3.7 - 2019-01-16

- Improved data reconciler performance
- Added data reconciler options

## 0.3.4 - 2019-01-04

- Added optional comparator for signals.
- Removed redundant type checks and extra function calls.
- Changed S.js to a dependency instead of a peer dependency.

## 0.3.2 - 2018-12-30

- Separated useSignal getter/setters for clearer more consistent API

## 0.3.1 - 2018-12-29

- Remove operators from core package since are auxilliary with new API.
- Updated JSX Dom Expressions to use new control flow JSX and JSX Fragment support.

## 0.3.0 - 2018-12-25

- New setState API inspired by Falcor paths to handle ranges.
- Reduction in API to remove State object functions and change to explicit methods.
- Expose reconcile method to do deep differences against immutable data sources (previously automatically done for selectors).
- Removed 'from' operators as limited usefulness with new patterns.

## 0.2.0 - 2018-11-13

- Large simplifications to remove inconsistency around wrapping and unwrapping values. State values are always wrapped get, and fully unwrapped on set.
- Updated binding syntax. Dynamic expressions are now bound with an inner parenthesis `{( )}`js
- Removed Immutable State object. May attempt something similar in the future but at this time it wasn't worth the effort trying to attempt both. There are better approaches to Proxy Immutable data structures.
