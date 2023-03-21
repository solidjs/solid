# Changelog

## 1.7.0 - 2023-03-x

Solid has experienced incredible growth in usage the last 6 months. Companies are using it to power production applications and SolidStart Beta has been a big part of that. As a natural part of this growth and increased use at scale we are continuing to learn what works well and what the rough edges in Solid are today.

This v1.7 release marks the beginning of the migration roadmap to v2.0. We are beginning to re-evaluate core APIs and will begin introducing new ones while reasonably deprecating older ones in a manner that eases breaking changes. Our intention is to ease the broader ecosystem into preparing for improvements that a major 2.0 will unlock for the whole community.

### Improved TypeScript

#### Type-Narrowed Control Flow

One of the pains of using Solid with TypeScript has been that JSX control flows can't really type narrow. This is true, but starting with the migration to explicit `keyed` in v1.5 we now complete this story by introducing callback forms for `<Show>` and `<Match>` that work when non-keyed.

The main difference is the callback form instead of passing in the value as it does when `keyed`, passes in a function that is type narrowed.

```js
// keyed w/ callback
<Show when={user()} keyed>
  {user => <div>{user.name}</div>}
</Show>

// non-keyed w/ callback
<Show when={user()}>
  {user => <div>{user().name}</div>}
</Show>

// non-keyed w/o callback... needs ! assertion
<Show when={user()}>
  <div>{user()!.name}</div>
</Show>
```

Keep in mind because we are non-null asserting the input signal using it in closures that execute when the condition is no longer satisfied can receive null values. There is no good solution for this. Luckily this only applies to things like timers which you should be cleaning up anyway and not things like event handlers. We recommend using the original source in those closures if you must, and will warn in development if you attempt to use it that way.

#### Stricter JSX Elements

Strict JSX elements have been tricky because we have to acknowledge at a certain point that TypeScript is to serve our purposes rather than to represent all possible values that could work. For us the ambiguity lies in functions.

Solid's JSX needs to accept functions to handle dynamic insertion. However, in authoring it leads to awkward situations.

The first you hit the first time use Solid. You create that counter and don't call `count` as a function and it works.

```js
function Counter() {
  const [count, setCount] = createSignal(1);

  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

This example works in some places and not others which might lead to the wrong conclusions.

The second place you might hit this is when you get a little further on your journey and decide you need a component to re-render and decide that you can just wrap the whole thing in a function:

```js
function MyComp(props) {
  return () => {
    // look working early returns
    if (props.count > 5) {
      return <div>Maximum Tries</div>;
    }

    return <div>Attempt {props.count}</div>;
  };
}
```

Again this seems fine, except the fact that every time `count` changes you are recreating all the DOM Elements even when it resolves to the same conditional.

Eventually you might even not think twice about passing functions into children of arbitrary components:

```js
<MyComp>
  <MyComp2>
    <MyComp3>{() => <div>{resource()}</div>}</MyComp3>
  </MyComp2>
</MyComp>
```

But what does this do? When is the function called?

As it turns out removing functions from `JSX.Element` type makes all of these scenarios error. Components only expect the values dictated by their types.

```js
function MyLayout(props: { children: JSX.Element }): JSX.Element;

function MyFor<T, U extends JSX.Element>(props: { each: T[],  children: (item: T) => U }): JSX.Element;

// valid
<MyLayout>Hello</MyLayout>
<MyLayout><p>Hello</p></MyLayout>
<MyLayout>{name()}</MyLayout>
<MyLayout>{name() && <p>Hello</p>}</MyLayout>
<MyLayout>{(() => {
  return <p{name()}</p>
})()}</MyLayout>
<MyLayout>{untrack(() => {
  return <p>{name()}</p>
})}</MyLayout>
<MyFor each={users()}>{(user) => <div>{user.name}</div>}</MyFor>

// invalid
<MyLayout>{name}</MyLayout>
<MyLayout>{() => <p>Hello</p>}</MyLayout>
<MyLayout>{() => "Hello"}</MyLayout>
<MyLayout>{() => name() && <p>Hello</p>}</MyLayout>
<MyFor each={users}>{(user) => <div>{user.name}</div>}</MyFor>
<MyFor each={users()}><div>Not a Function</div></MyFor>
```

### Better Errors and Cleanup

#### `catchError` replaces `onError`

Error Handling is complicated enough without having to try to guess how they propagate. `onError` admittedly is a lower level primitive but fundamentally had this flaw. It worked by registering an error handler on the parent scope, but left it ambiguous how to handle siblings. Is it a queue? Are they independent?

As a result we are introducing `catchError` in this release which introduces its own scope to catch any errors below it. The first argument in the primitive is similar to the try and the second argument is the catch.

```js
catchError(
  () => {
    // do stuff
    throw new Error("I've Errored");
  },
  err => console.log(err)
);
```

`onError` will still be present until it can be removed in a future major version.

#### Standardized Errors

Error Handling has had many weird edge cases introduced by applications throwing unusual values. In v1.7 we wrap all thrown values that aren't of type `Error` in a `new Error` and attach the original thrown value as `.cause`.

### More Performant Dev Tools

Now that [Solid Dev Tools](https://github.com/thetarnav/solid-devtools) have been stabilizing, we have a much better idea what support we need for them. In so we were able to remove the very costly serialization we were doing for generating unique identifiers. Conventions around naming and exports were streamlined and standardized as well.

### Others

- Smaller compiled output, remove auxilary closing tags
- Support for `prop:` and `attr:` in Spreads
- Don't apply special props (like `readonly`) to custom elements
- Introduced improved serializer, [seroval](https://github.com/lxsmnsyc/seroval)
- Fixed quirks in Solid's treeshaking in Rollup

## 1.6.0 - 2022-10-20

Solid v1.6 doesn't bring a ton of new features but brings some big improvements in existing ones.

### Highlights

#### Official Partial Hydration Support

Solid has worked for quite some time in partial hydrated ("Islands") frameworks like Astro, Iles, Solitude, etc.. but now we have added core features to support this effort better. These features are mostly designed for metaframework authors rather than the end user they are exposed through a couple APIs.

`<Hydration />` joins `<NoHydration />` as being a way to resume hydration and hydration ids during server rendering. Now we can stop and start hydratable sections. This is important because it opens up a new optimization.

`createResource` calls under non-hydrating sections do not serialize. That means that resources that are server only stay on the server. The intention is that hydrating Islands can then serialize their `props` coming in. Essentially only shipping the JSON for data actually used on the client.

The power here is static markup can interview dynamic components.

```js
<h1>Server Rendered Header</h1>
<Island>
  <h2>Server Rendered Sub Header</h2>
  <p>{serverOnlyResource().text}</p>
  <DifferentIsland>
    <p>More server-renderd content</p>
  </DifferentIsland>
</Island>
```

Keep in mind Server rendered content like this can only be rendered on the server so to maintain a client navigation with this paradigm requires a special router that handles HTML partials.

Similarly we want the trees to talk to each other so `hydrate` calls now have been expanded to accept a parent `Owner` this will allow Islands to communicate through Contex without shipping the whole tree to browser.

```js
<h1>Server Rendered Header</h1>
<ClientProvider>
  <h2>Server Rendered Sub Header</h2>
  <ClientIslandThatReadsContext />
</ClientProvider>
```

These improvements make it easier to create Partial Hydration solutions on top of Solid, and serve to improve the capabilities of the ones we already have.

#### Native Spread Improvements

Native spreads are something we started at very naively. Simply just iterating an object that has some reactive properties and updating the DOM element. However, this didn't take into consideration two problems.

First properties on objects can change, they can be added or removed, and more so the object itself can be swapped. Since Solid doesn't re-render it needs to keep a fixed reference to the merged properties. Secondly, these are merged. Properties override others. What this means is we need to consider the element holistically to know that the right things are applied.

For Components this was a never a problem since they are just function calls. Unfortunately for native elements this means all those compiler optimizations we do for specific bindings now need to get pulled into this. Which is why we avoided it in the past. But the behavior was too unpredictable.

In 1.6 we have smartened spread to merge properly using similar approach to how process Components. We've also found new ways to optimize the experience. (See below).

### Other Improvements

#### Deproxification

Working on new Spread behavior we realized that while we can't tell from compilation which spreads can change. We can tell at runtime which are proxies. And in so if we only need to merge things which don't swap, and aren't proxies we can avoid making a Proxy.

What is great about this is it has a cascading effect. If component props aren't a proxy, then `splitProps` and `mergeProps` don't need to create them, and so on. While this requires a little extra code it is a real win.

We get a lot request for low end IoT devices because of Solid's incredible performance. In tests Solid outperforms many of the Virtual DOM solutions in this space. However most of them don't support proxies.

So now if you don't use a `Store` or swap out the props object:

```js
// this is fine
<div {...props} />

// these could swap out the object so they make proxies
<div {...props.something} />
// or
<div {...someSignal()} />
```

We don't need to introduce any proxy the user didn't create. This makes Solid a viable option for these low-end devices.

## 1.5.0 - 2022-08-26

### Key Highlights

#### New Batching Behavior

Solid 1.4 patched a long time hole in Solid's behavior. Until that point Stores did not obey batching. However, it shone a light on something that should maybe have been obvious before. Batching behavior which stays in the past is basically broken for mutable data, No Solid only has `createMutable` and `produce` but with these sort of primitives the sole purpose is that you perform a sequence of actions, and batching not making this properly was basically broken. Adding an element to an array then removing another item shouldn't just skip the first operation.

```js
const store = createMutable(["a", "b", "c"]);

const move = store.splice(1, 1);
store.splice(0, 0, ...move);

// solid 1.4
// ["b", "a", "b", "c"];

// solid 1.5
// ["b", "a", "c"];
```

After a bunch of careful thought and auditting we decided that Solid's `batch` function should behave the same as how reactivity propagates in the system once a signal is set. As in we just add observers to a queue to run, but if we read from a derived value that is stale it will evaluate eagerly. In so signals will update immediately in a batch now and any derived value will be on read. The only purpose of it is to group writes that begin outside of the reactive system, like in event handlers.

#### More Powerful Resources

Resources continue to get improvements. A common pattern in Islands frameworks like Astro is to fetch the data from the out side and pass it in. In this case you wouldn't want Solid to do the fetching on initial render or the serialization, but you still may want to pass it to a resource so it updates on any change. For that to work reactivity needs to run in the browser. The whole thing has been awkward to wire up but no longer.

`ssrLoadFrom` field lets you specify where the value comes from during ssr. The default is `server` which fetches on the server and serializes it for client hydration. But `initial` will use the `initialValue` instead and not do any fetching or addtional serialization.

```js
const [user] = createResource(fetchUser, {
  initialValue: globalThis.DATA.user,
  ssrLoadFrom: "initial"
});
```

We've improved TypeScript by adding a new `state` field which covers a more detailed view of the Resource state beyond `loading` and `error`. You can now check whether a Resource is `"unresolved"`, `"pending"`, `"ready"`, `"refreshing"`, or `"error"`.

| state      | value resolved | loading | has error |
| ---------- | -------------- | ------- | --------- |
| unresolved | No             | No      | No        |
| pending    | No             | Yes     | No        |
| ready      | Yes            | No      | No        |
| refreshing | Yes            | Yes     | No        |
| errored    | No             | No      | Yes       |

A widely requested feature has been allowing them to be stores. While higher level APIs are still being determined we now have a way to plugin the internal storage by passing something with the signature of a signal to the new _Experimental_ `storage` option.

```js
function createDeepSignal<T>(value: T): Signal<T> {
  const [store, setStore] = createStore({
    value
  });
  return [
    () => store.value,
    (v: T) => {
      const unwrapped = unwrap(store.value);
      typeof v === "function" && (v = v(unwrapped));
      setStore("value", reconcile(v));
      return store.value;
    }
  ] as Signal<T>;
}

const [resource] = createResource(fetcher, {
  storage: createDeepSignal
});
```

#### Consolidated SSR

This release marks the end of years long effort to merge async and streaming mechanism. Since pre 1.0 these were seperate. Solid's original SSR efforts used reactivity on the server with different compilation. It was easiest to migrate synchronous and streaming rendering and for a time async had a different compilation. We got them on the same compilation 2 years ago but runtimes were different. Piece by piece things have progressed until finally async is now just streaming if flushed at the end.

This means some things have improved across the board. Async triggered Error Boundaries previously were only ever client rendered (throwing an error across the network), but now if they happen any time before sending to the browser they are server rendered. `onCleanup` now runs on the server if a branch changes. Keep in mind this is for rendering effects (like setting a status code) and not true side effects as not all rendering cleans up.

Finally we've had a chance to do a bunch of SSR rendering performance improvements. Including replacing our data serializer with an early copy of Dylan Piercey from [Marko](https://markojs.com)'s upcoming serializer for Marko 6. Which boasts performance improvements of up to 6x `devalue` which we used previously.

#### Keyed Control Flow

Solid's `<Show>` and `<Match>` control flow originally re-rendered based on value change rather than truthy-ness changing. This allowed the children to be "keyed" to the value but lead to over rendering in common cases. Pre 1.0 it was decided to make these only re-render when statement changed from `true` to `false` or vice versa, except for the callback form that was still keyed.

This worked pretty well except it was not obvious that a callback was keyed. So in 1.5 we are making this behavior explicit. If you want keyed you should specify it via attribute:

```js
// re-render whenever user changes

// normal
<Show when={user()} keyed>
  <div>{user().name}</div>
</Show>

// callback
<Show when={user()} keyed>
  {user => <div>{user.name}</div>}
</Show>
```

However, to not be breaking if a callback is present we will assume it's keyed. We still recommend you start adding these attributes (and TS will fail without them).

In the future we will introduce a non-keyed callback form as well so users can benefit from type narrowing in that case as well.

### Other Improvements

### `children.toArray`

Children helper now has the ability to be coerced to an array:

```js
const resolved = children(() => props.children);
resolved.toArray(); // definitely an array
```

#### Better SSR Spreads

Finally fixed spread merging with non-spread properties during SSR, including the ability to merge children.

#### Better Error Handling

We weren't handling falsey errors previously. Now when Solid receives an error that isn't an `Error` object or a string it will coerce it into an `Unknown Error`.

## 1.4.0 - 2022-05-12

### New Features

#### Resource Deferred Streaming

Streaming brings a lot of performance benefits but it also comes with the tradeoff we need to respond with the headers before we can send any content. This means we must set the Response headers early if we want to benefit from streaming. While it's always possible to fetch first and delay rendering that slows down everything. Even our async server rendering doesn't block rendering but instead just waits to respond to the end.

But what if you want to stream but also want to wait on some key data loading so you still have an opportunity to handle the response on the server before sending it to the browser?

We now have the ability to tell Solid's stream renderer to wait for a resource before flushing the stream. That you can opt in by setting `deferStream` option.

```js
// fetches a user and streams content as soon as possible
const [user] = createResource(() => params.id, fetchUser);

// fetches a user but only streams content after this resource has loaded
const [user] = createResource(() => params.id, fetchUser, { deferStream: true });
```

#### Top Level Arrays in Stores

Since Stores were first introduced it has always bugged me that the most common case, creating a list required nesting it under a property to track properly. Thanks to some exploration into proxy traps and iteration we now support top level arrays. In addition to its other modes, the Store setter will accept an array which allows for common operations.

```js
const [todos, setTodos] = createStore([
  { id: 1, title: "Thing I have to do", done: false },
  { id: 2, title: "Learn a New Framework", done: false }
]);

// set at an index
setTodos(1, done, true);

// use an array
setTodos([...todos, { id: 3, title: "New Todo", done: false }])

// iterate over it with <For>
<For each={todos}>{todo => <Todo todo={todo} />}</For>;
```

Through this change we also stopped over execution when listening to specific properties. To support iteration Solid previously would notify the owning object of any array when an was index added/removed or object new property created or deleted on any object.

The one caveat is downstream optimized control flow that untrack index reads on arrays will now need to track the iterated object explicity. Solid exports a `$TRACK` symbol used to subscribe to the object and all its properties.

#### Stale Resource Reads

Suspense and Transitions are amazingly powerful feature but occasionally you want to opt out of the consistency and show things out of date because it will show up faster and some of things you are waiting for are not as high priority. In so you want the Transition to end sooner, but not necessarily stop showing the stale data for part of the screen. It is still preferable to receding back to loading spinner state.

Solid's Resources now support being able to read the value without triggering Suspense. As long as it has loaded previously `latest` property won't cause fallback appear or Transitions to hold. This will always return the `latest` value regardless whether it is stale (ie.. a new value is being fetched) and will reactively update. This is super powerful in Transitions as you can use the Resources own `loading` state to know if it is stale. Since the Transition will hold while the critical data is loading, the loading state will not be applied to the in view screen until that Transition has ended. If the resource is still loading now you can show that it is stale.

```js
const [resource] = createResource(source, fetcher);

// read it as usual
resource();

// read the latest (don't suspend if loaded at least once)
resource.latest;
```

Example: https://codesandbox.io/s/solid-stale-resource-y3fy4l

#### Combining multiple Custom Renderers

The Babel plugin now allows configuring multiple custom renderers at the same time. The primary case it is so a developer can still lever Solid's optimized DOM compilation while using their custom renderer. To make this work specify the tags each renderer is reponsible for. It will try to resolve them in order.

```js
import { HTMLElements, SVGElements } from "solid-js/web";
let solidConfig = {
  moduleName: "solid-js/web",
  // @ts-ignore
  generate: "dynamic",
  renderers: [
    {
      name: "dom",
      moduleName: "solid-js/web",
      elements: [...HTMLElements, ...SVGElements]
    },
    {
      name: "universal",
      moduleName: "solid-three",
      elements: []
    }
  ]
};
```

### Improvements/Fixes

#### Synchronous Top Level `createEffect`

These were originally deferred to a microtask to resemble how effects are queued under a listener. However it is more correct to run immediate like everything else top level.

#### Better Types around Components

This one took the effort of many resident TypeScript experts, but we've now landed on some better types for components. The biggest change is `Component` no longer has an opinion on whether it should have `children` or not. We've added supplementary types `ParentComponent` and `FlowComponent` to denote Components that may have `children` or always have `children`. And we've added `VoidComponent` for those which may never have children.

#### Sources in `createResource` are now Memos

A small change but it was unusual to have refetching trigger a reactive expression outside of a reactive context. Now on refetch it grabs the last source value rather than re-running it.

#### `createMutable` batches array methods like push, pop, etc..

Now these built-ins are batched and more performant. We've also add `modifyMutable` that applies modifiers batched to stores created with `createMutable`.

```js
modifyMutable(state.data.user, reconcile({ firstName: "Jake", middleName: "R" }));
```

#### Stores and mutables now respect batch

Writing to a store or mutable within `batch` (including effects) no longer immediately updates the value, so reading within the same batch gives the old value. This guarantees consistency with memos and other computations, just like signals.

#### Better Support for React JSX transform

We have added support to `solid-js/h` to support the new React JSX transform. You can use it directly in TypeScript by using:

```json
{
  "jsx": "react-jsx",
  "jsxImportSource": "solid-js/h"
}
```

Keep in mind this has all the consequences of not using the custom transform. It means larger library code, slower performance, and worse ergonomics. Remember to wrap your reactive expressions in functions.

#### HyperScript now returns functions

This one is a potentially breaking change, but the current behavior was broken. It was possible(and common) for children to be created before the parents the way JSX worked. This was an oversight on my original design that needs to be fixed, as it breaks context, and disposal logic. So now when you get your results back from `h` you need to call it. Solid's `render` function will handle this automatically.

```js
const getDiv = h("div", "Hello");

document.body.appendChild(getDiv()); // call as a function to have it create the element.
```

### Removals and Deprecations

#### `className`, `htmlFor` deprecated

While they still work for now, Solid will remove support for these React-isms in a future version. They leave us with multiple ways to set the same attribute. This is problematic for trying to merge them. Solid updates independently so it is too easy for these things to trample on each other. Also when optimizing for compilation since with things like Spreads you can't know if the property is present, Solid has to err on the side of caution. This means more code and less performance.

#### Experimental `refetchResources` removed

This primitive ended up being too general to be useful. There are enough cases we can't rely on the refetch everything by default mentality. For that reason we are dropping support of this experimental feature.

## 1.3.0 - 2022-01-05

### New Features

#### HTML Streaming

This release adds support for HTML streaming. Now we not only stream data after the initial shell but the HTML as it finishes. The big benefit is that now for cached results, or times when the network are slow we no longer have to show the placeholder while waiting for JavaScript bundle to load. As soon as the HTML is available it will be streamed and inserted.

With it comes new streaming API `renderToStream`. This is a universal API designed to handle both Node and Web writable streams. It returns an object that mirrors a Readable stream on both platforms that has both `pipe` (node) and `pipeTo` (web). The benefit of this `pipe` API is the user can choose when to insert the content in the output stream whether soon as possible, or `onCompleteShell`, or `onCompleteAll`. This decouples Solid's rendering a from the stream a bit but leaves things open to performance improvements in the future.

```js
// node
const stream = renderToStream(() => <App />).pipe(res);

// web
const stream = renderToStream(() => <App />).pipeTo(writable);
```

#### Error Boundaries on the Server

We've added support for Error Boundaries on the Server for all rendering methods(`renderToString`, `renderToStringAsync`, `renderToStream`). Errors can be caught both from synchronous rendering and from errors that happen in Resource resolution. However, Our approach doesn't guarentee all errors are handled on the server as with streaming it is possible that the Error Boundary has already made it to the browser while a nested Suspense component hasn't settled. If an Error is hit it will propagate up to the top most Suspense Boundary that hasn't been flushed yet. If it is not handled by an Error Boundary before that it will abort rendering, and send the Error to the browser to propagate up to the nearest Error Boundary.

This works now but there is more to explore here in improving Error handling in general with SSR. So look forward to feedback on the feature.

#### Isolated Server Render/Hydration Contexts

Sometimes you want to server render and hydrate multiple Solid apps on the same page. Maybe you are using the Islands architecture with something like [Astro](https://astro.build). We now have the ability to pass a unique `renderId` on all our server rendering methods and to the `hydrate` function. This will isolate all hydration and resource resolution. This means we can use things like server side Suspense in these solutions.

Also now you only need to include the Hydration Script once on the page. Each Island will be responsible for initializing it's own resources.

```js
// on the server
const html = renderToString(() => <Island1 />, { renderId: "island1" });

// for the browser
hydrate(() => <Island1 />, mountEl, { renderId: "island1" });
```

#### `createReaction`

This new primitive is mostly for more advanced use cases and is very helpful for interopt with purely pull based systems (like integrating with React's render cycle). It registers an untracked side effect and returns a tracking function. The tracking function is used to track code block, and the side effect is not fired until the first time any of the dependencies in the tracking code is updated. `track` must be called to track again.

```js
const [s, set] = createSignal("start");

const track = createReaction(() => console.log("something"));

// next time s changes run the reaction
track(() => s());

set("end"); // "something"

set("final"); // no-op as reaction only runs on first update, need to call track again.
```

This primitive is niche for certain use cases but where it is useful it is indispensible (like the next feature which uses a similar API).

#### External Sources (experimental)

Ever wanted to use a third party reactive library directly in Solid, like MobX, Vue Reactivity, or Kairo. We are experimenting with adding native support so reactive atoms from these libraries can be used directly in Solid's primitives and JSX without a wrapper. This feature is still experimental since supporting Transitions and Concurrent Rendering will take some more effort. But we have added `enableExternalSource` enable this feature. Thanks @3Shain for designing this solution.

```js
import { Reaction, makeAutoObservable } from "mobx";
import { enableExternalSource } from "solid-js";
import { render } from "solid-js/web";

let id = 0;
enableExternalSource((fn, trigger) => {
  const reaction = new Reaction(`externalSource@${++id}`, trigger);
  return {
    track: x => {
      let next;
      reaction.track(() => (next = fn(x)));
      return next;
    },
    dispose: () => {
      reaction.dispose();
    }
  };
});

class Timer {
  secondsPassed = 0;

  constructor() {
    makeAutoObservable(this);
  }

  increase() {
    this.secondsPassed += 1;
  }

  reset() {
    this.secondsPassed = 0;
  }
}

// component driven directly off MobX
function App() {
  const timer = new Timer();
  setInterval(() => {
    timer.increase();
  }, 1000);

  return <button onClick={() => timer.reset()}>Seconds passed: {timer.secondsPassed}</button>;
}

render(() => <App />, document.getElementById("app"));
```

#### `refetchResources` (experimental)

In efforts to allow for scaling from simple resources up to cached solutions we are adding some experimental features to `createResource` to work with library writers to develop the best patterns. Caching is always a tricky problem and with SSR and streaming being part of the equation the core framework needs at minimum to provide some hooks into orchestrating them.

Sometimes it's valuable to trigger `refetch` across many resources. Now you can.

```js
import { createResource, refetchResources } from "solid-js";

const userCache = {};

function MyComponent(props) {
  const [data] = createResource(
    () => props.id,
    (userId, { refetching }) => {
      const cached = userCache[userId];

      // return cached value if available and not refetching
      if (cached && !refetching) return cached;
      return fetchUser(userId);
    }
  );
}

// somewhere else
refetchResources();
```

You can also pass a parameter to `refetchResources` to provide additional information to the `refetching` info of the fetcher. This could be used for conditional cache invalidation. Like only refetch resources related to `users`. This mechanism requires a bit of wiring but the idea is you'd wrap `createResource` in maybe a `createQuery` and implement your own conventions around resource cache management. Still working out how this should work best, but the goal is to provide the mechanisms to support resource caches without being responsible for their implementation.

To opt-out being part of the global refetch createResource now takes a `globalRefetch` option that can be set to false. In addition to a new option to disable `refetchResources` there is no an `onHydrated` callback that takes the same arguments as the fetcher. When a resource is restored from the server the fetcher is not called. However, this callback will be. This is useful for populating caches.

### Improvements

#### Better TypeScript Support

Thanks to the tireless efforts of several contributors we now have significantly better types in Solid. This was a huge effort and involved pulling in maintainers of TypeScript to help us work through it. Thank you @trusktr for spearheading the effort.

#### Better SourceMaps

Work has been done to improve sourcemaps by updating `babel-plugin-dom-expressions` to better preserve identifiers from the JSX. Thanks to @LXSMNSYC for exploring and implementing this.

### Breaking Changes/Deprecations

#### `startTransition` no longer takes callback as a second argument

Instead it returns a promise you can await. This works better for chaining sequences of actions.

```js
const [start, isPending] = useTransition();

start(() => doSomething()).then(() => allDone());
```

#### Resource fetcher info object replaces `getPrev`

To streamline API for refetch we are slightly updating the `createResource`:

```js
const [data] = createResource(sourceSignal, (source, { value, refetching }) => {});
```

For those using existing 2nd argument:

```js
const [data] = createResource(sourceSignal, (source, getPrev) => {
  const value = getPrev();
});

// becomes
const [data] = createResource(sourceSignal, (source, { value }) => {});
```

#### Deprecating Legacy Streaming APIs

`pipeToNodeWritable` and `pipeToWritable` are deprecated. They will still work for now with basic usage but some of the more advanced options didn't map over to the new APIs directly and have been removed. Move to using `renderToStream`.

### Bug Fixes

- Fixed browser extensions modifying the head breaking hydration.
- Fixed reinserting `<html>` on hydration from document.
- Fixed over-executing on multi-select with `createSelector`.
- Fixed event delegation conflicting with document event listeners.
- Fixed self owning source infinite recursion.
- Fixed faulty treesplitting for hydration in client only render.
- Fixed return type of `preload` on lazy components to always be a promise.
- Fixed compile error with leading white space after opening tags when generating ssr.

## 1.2.0 - 2021-10-25

### New Features

#### Custom Renderers

This release adds support custom renderers through a new "universal" transform. Solid now provides a sub module `solid-js/universal` that exports a `createRenderer` method that allows you to create your own runtimes. This will enable things like native mobile and desktop, canvas and webgl, or even rendering to the terminal. This is still new so very much looking for feedback.

#### Spreads Added to Solid's `html`

It's been a long time coming but Solid's Tagged Template Literals now support element and component spreads using htm inspired syntax.

```js
html`<div ...${props} />`;
```

### Fixes

#### Dynamic Spreads now work on Components

Previously spreads on components would only track property changes on bound objects and not when the whole object changed. This now works:

```js
<MyComponent {...getStuff()} />
```

#### ClassList properly merges multiple classnames in the key

It is common in libraries like Tailwind to apply multiple classes at the same time. There was an issue where true and false resolutions were cancelling each other out. This would only set `text-sm`.

```js
<div
  classList={{
    "px-2.5 py-1.5 text-xs": false,
    "px-3 py-2 text-sm": false,
    "px-4 py-2 text-sm": true,
    "px-4 py-2 text-base": false,
    "px-6 py-3 text-base": false
  }}
/>
```

#### Consistent handling of HTMLEntities

Things like `&nbsp;` used to render differently depending if in elements or components(or fragments). This has been made consistent across all three.

#### Various improvements to Types and Transitions

A lot of bugs from the last minor release were around Transitions that have been addressed. And as always Types have been gradually improving.

## 1.1.0 - 2021-08-09

Expanding Solid's concurrency to include scheduling. Bug fixes around Types and around reactive execution order guarantees.

### New Features

#### `createUniqueId`

A universal id generator that works across server/browser.

```js
const id = createUniqueId();
```

> **Note** on the server this only works under hydratable components

#### `from`

A simple helper to make it easier to interopt with external producers like RxJS observables or with Svelte Stores. This basically turns any subscribable (object with a `subscribe` method) into a Signal and manages subscription and disposal.

```js
const signal = from(obsv$);
```

It can also take a custom producer function where the function is passed a setter function returns a unsubscribe function:

```js
const clock = from(set => {
  const t = setInterval(() => set(1), 1000);
  return () => clearInterval(t);
});
```

> Note: Signals created by `from` have equality checks turned off to interface better with external streams and sources.

#### `enableScheduling` (experimental)

By default Solid's concurrent rendering/Transitions doesn't schedule work differently and just runs synchronously. Its purpose is to smooth out IO situations like Navigation. However now you can opt into interruptible scheduling similar to React's behavior by calling this once at your programs entry. I've yet to see a realworld scenario where this makes a big difference but now we can do cool demos too and start testing it.

#### `startTransition`

Works like its counterpart in `useTransition`, this useful when you don't need pending state.

```js
import { createSignal, startTransition } from "solid-js";

function App() {
  const [signal, setSignal] = createSignal("Howdy");
  function clickHandler(e) {
    startTransition(() => setSignal("Holla"));
  }

  /* ...stuff */
}
```

## 1.0.0 - 2021-06-27

### Breaking Changes

### setSignal now supports function form

While that in itself is a great new feature as you can do:

```js
const [count, setCount] = createSignal(0);

setCount(c => c + 1);
```

This promotes immutable patterns, let's you access the previous value without it being tracked, and makes Signals consistent with State.

It means that when functions are stored in signals you need to use this form to remove ambiguity

```js
const [count, setCount] = createSignal(ComponentA);

// Do this:
setCount(() => ComponentB);

// Don't do this as it will call the function immediately:
setCount(ComponentB);
```

#### `createState` moved and renamed

`createState` has been renamed to `createStore` and moved to `solid-js/store`. Also moved to `solid-js/store`: `createMutable`, `produce`, `reconcile`

#### SSR Entry points

`renderToString` and `renderToStringAsync` now only return their stringified markup. To insert scripts you need to call `generateHydrationScript` or use the new `<HydrationScript>` component.

`renderToNodeStream` and `renderToWebStream` have been replaced with `pipeToNodeWritable` and `pipeToWritable`, respectively.

#### Options Objects

Most non-essential arguments on reactive primitives are now living on an options object. This was done to homogenize the API and make it easier to make future additions while remaining backwards compatible.

#### on

No longer uses rest parameters for multiple dependencies. Instead pass an array. This facilitates new option to defer execution until dependencies change.

#### Actions renamed to Directives

To remove future confusion with other uses of actions the `JSX.Actions` interace is now the `JSX.Directives` interface.

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

This release is about refining the APIs as we approach the our release candidate for 1.0.

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
const [data] = createResource(async () => (await fetch(`https://someapi.com/info`)).json());
```

#### on/onCapture

These are an escape hatch for unusual events. Previously these were custom attributes but now they are namespaced like:

```jsx
<div on:someUnusualEvent={e => console.log(e.target)} />
```

#### change `main` field to be node

Now that we are supporting SSR for legacy(non-ESM) systems I need to use the main field to indicate a node env. We will be using the "browser" field for the client build in Solid. This straight up breaks Jest which doesn't respect that. I've created `solid-jest` to handle this.

https://github.com/solidjs/solid-jest

### New Features

#### Namespace Types

Types added for Namespace attributes. You probably won't need most of these because they are for more advanced usage. However to use them you need to extend the JSX Namespace:

```ts
declare module "solid-js" {
  namespace JSX {
    interface Directives {
      // use:____
    }
    interface ExplicitProperties {
      // prop:____
    }
    interface ExplicitAttributes {
      // attr:____
    }
    interface CustomEvents {
      // on:____
    }
    interface CustomCaptureEvents {
      // oncapture:____
    }
  }
}
```

#### Lazy component preload

Lazy components now have a preload function so you can pre-emptively load them.

```js
const LazyComp = lazy(() => import("./some-comp"));

// load ahead of time
LazyComp.preload();
```

#### Error Boundary reset

Error boundaries now have the ability to reset themselves and try again. It is the second argument to the fallback.

```js
<ErrorBoundary
  fallback={(err, reset) => {
    if (count++ < 3) return reset();
    return "Failure";
  }}
>
  <Component />
</ErrorBoundary>
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

In addition the reactive model brings updates to Suspense and Transitions. Solid now has true concurrent rendering at a granular level. This mechanism does differ from React as it currently only supports a single future.

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
