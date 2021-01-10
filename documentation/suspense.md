# Suspense

Suspense is an API designed to seamlessly integrate asynchronous processes into Solid's synchronous reactive system.

## Asynchronous Rendering

In Solid all reactive nodes must be created as part of execution of another reactive node starting at the root node that is created in the `render` method. Even though the graph must be created synchronously updates to a particular node can be triggered asynchronously. Once a node is running more reactive nodes can be created. In so, rendering can be achieved piecewise as long as the next node is created as part of the current execution. This is essentially asynchronous rendering.

> **For React Users:** Time splitting is trivial for a library like Solid since the primitives are already finer grained. While it is true there is always the cost of initial rendering, unlike React doing part of the work and then triggering an update to do the rest of the work doesn't cause the whole tree to reconcile again.

A simple example of this would be something like this:

```jsx
function Deferred(props) {
  const [resume, setResume] = createSignal(false);
  setTimeout(() => setResume(true), 0);

  return <Show when={resume()}>{props.children}</Show>;
}

// somewhere in a view
<>
  <ComponentA />
  <Deferred>
    {/* doesn't render right away */}
    <ComponentA />
  </Deferred>
</>;
```

Solid does include a scheduler similar to React's Concurrent Mode scheduler which allows work to be scheduled in idle frames. The easiest way to leverage it is to use `createDeferred` which creates a memo that will only be read as the cpu is available.

```jsx
function App() {
  const [text, setText] = createSignal("hello");
  const deferredText = createDeferred(text, { timeoutMs: 2000 });

  return (
    <div className="App">
      {/* Keep passing the current text to the input */}
      <input value={text()} onChange={handleChange} />
      ...
      {/* But the list is allowed to "lag behind" when necessary */}
      <MySlowList text={deferredText()} />
    </div>
  );
}
```

## Placeholders & Transitions(Experimental)

But what if we don't control when the asynchronous action returns and we need to deal with potentially multiple asynchronous actions. This is where Suspense comes in. It inverts the control, so that the child can manage its asynchronous needs and the parent just sets the rules of how to display the fallback content that is shown as these processes complete. Unlike conditional control flow (like the `Deferred` component above) the children are not blocked and get execute their asynchronous actions triggering Suspense rather than pushing the responsibility on the parent. Suspense consists of 2 states:

- normal - This is when no asynchronous actions are being processed and the system is working as normal.
- fallback - This is the fallback content (like a loading spinner) to show in place of the loading if the asynchronous actions have not completed by the time the delay has run out.

Consider the simple case of switching between 3 tabs which have asynchronous loaded tabs. To use Suspense you need to use the `Suspense` Component to wrap the asynchronous activity.

```jsx
import { createState, Suspense } from "solid-js";

function App() {
  const [state, setState] = createState({ activeTab: 1 });

  return (
    <>
      <ul>
        <li onClick={() => setState({ activeTab: 1 })}>Tab1</li>
        <li onClick={() => setState({ activeTab: 2 })}>Tab2</li>
        <li onClick={() => setState({ activeTab: 3 })}>Tab3</li>
      </ul>
      <Suspense fallback={<LoadingSpinner />}>
        <Switch>
          <Match when={state.activeTab === 1}>...</Match>
          <Match when={state.activeTab === 2}>...</Match>
          <Match when={state.activeTab === 3}>...</Match>
        </Switch>
      </Suspense>
    </>
  );
}
```

In this case if the tab hasn't loaded you will see a `LoadingSpinner` and as you switch you will see another `LoadingSpinner` as it moves in and out of suspended state.

But we can do more when we already have data loaded. We can avoid going back to the fallback state by leveraging `useTransition`. It returns a method to wrap state updates that can be deferred and an method that tracks whether the transition is currently active. When control flow is suspended it continues to show the current branch while rendering the next off screen. Resource reads under existing boundaries add it the transition. Any new nested `Suspense` components with drop to "fallback"

```jsx
import { createState, useTransition, Suspense } from "solid-js";

function App() {
  const [state, setState] = createState({ activeTab: 1 }),
    [isPending, startTransition] = useTransition();

  return (
    <>
      <ul disabled={isPending()}>
        <li onClick={() => startTransition(() => setState({ activeTab: 1 }))}>Tab1</li>
        <li onClick={() => startTransition(() => setState({ activeTab: 2 }))}>Tab2</li>
        <li onClick={() => startTransition(() => setState({ activeTab: 3 }))}>Tab3</li>
      </ul>
      <Suspense fallback={<LoadingSpinner />}>
        <Switch>
          <Match when={state.activeTab === 1}>...</Match>
          <Match when={state.activeTab === 2}>...</Match>
          <Match when={state.activeTab === 3}>...</Match>
        </Switch>
      </Suspense>
    </>
  );
}
```

> **For React Users:** Given the nature of Solid's Reactive system, the throw a promise approach React uses doesn't make sense here. React just re-runs that part of the tree again, whereas Solid cannot pickup from where it left off. Instead Solid's Suspense mechanism ties into the Context API. Like React it is the closest Suspense Component that handles the Suspense state.

## Code Splitting

The first use for using Suspense is lazy loading components. This easily allows the browser or bundlers like Webpack to code split. That way the page can be loaded with part of the JavaScript code and the rest can be loaded separately as needed. Solid's `lazy` takes the dynamic import of Component that is the default export of a module and turns it into a Component you can define in your JSX view. You can pass props and interact with it as if it were the Component you were importing itself. However, this Component doesn't render until its code has been asynchronously loaded and doesn't trigger loading until it is to be rendered.

```jsx
import { lazy } from "solid-js";
const OtherComponent = lazy(() => import("./OtherComponent"));

function MyComponent() {
  return (
    <div>
      <Suspense fallback={<div>Loading...</div>}>
        <OtherComponent />
      </Suspense>
    </div>
  );
}
```

There are lots of potential patterns for code splitting, but routing is a good start. For instance taking the example from the previous section, we can defer loading our Component to when the corresponding tab becomes active:

```jsx
import { Suspense } from "solid-js";

const ComponentA = lazy(() => import("./ComponentA"));
const ComponentB = lazy(() => import("./ComponentB"));
const ComponentC = lazy(() => import("./ComponentC"));

const App = () => {
  const [state, setState] = createState({ activeTab: 1 });

  return (
    <Suspense fallback={<LoadingSpinner />} maxDuration={300}>
      <Switch>
        <Match when={state.activeTab === 1}>
          <ComponentA />
        </Match>
        <Match when={state.activeTab === 2}>
          <ComponentB />
        </Match>
        <Match when={state.activeTab === 3}>
          <ComponentC />
        </Match>
      </Switch>
    </Suspense>
  );
};
```

## Data Loading

Solid ships with two resource containers to handle async loading. One is a signal created by `createResource` and the other a state object created by `createResourceState`. The signal is a simple reactive atom so it's reactivity is not deeply nested. Whereas state deeply nests reactive properties.

Both have trackable `loading` property. On the signal it's a boolean. On the state object it is an object with a boolean per key.

```jsx
import { createResource } from "solid-js";

// notice returns a function that returns a promise
const fetchUser = id =>
  () => fetch(`https://swapi.co/api/people/${id}/`).then(r => r.json());

export default const UserPanel = props => {
  let [user, load] = createResource();
  load(fetchUser(props.userId)));

  return <div>
    <Switch fallback={"Failed to load User"}>
      <Match when={user.loading}>Loading...</Match>
      <Match when={user()}>{ ({ name, height, mass, birthYear }) =>
        <h1>{name}</h1>
        <ul>
          <li>Height: {height}</li>
          <li>Mass: {mass}</li>
          <li>Birth Year: {birthYear}</li>
        </ul>
      }</Match>
    </Switch>
  </div>
}
```

```jsx
import { createResourceState } from "solid-js";


// notice returns a function that returns a promise
const fetchUser = id =>
  () => fetch(`https://swapi.co/api/people/${id}/`).then(r => r.json());

export default const UserPanel = props => {
  let [state, load] = createResourceState();
  load({ user: fetchUser(props.userId) });

  return <div>
    <Switch fallback={"Failed to load User"}>
      <Match when={state.loading.user}>Loading...</Match>
      <Match when={state.user}>{ user =>
        <h1>{user.name}</h1>
        <ul>
          <li>Height: {user.height}</li>
          <li>Mass: {user.mass}</li>
          <li>Birth Year: {user.birthYear}</li>
        </ul>
      }</Match>
    </Switch>
  </div>
}
```

These examples handle the different loading states. However, you can expand this example to use Suspense instead by wrapping with the `Suspense` Component.

> **For React Users:** At the time of writing this React has not completely settled how their Data Fetching API will look. Solid ships with this feature today, and it might differ from what React ultimately lands on.

## Render as you Fetch

It is important to note that Suspense is tracked based on data requirements of the the reactive graph not the fact data is being fetched. Suspense is enacted when a child of a Suspense Component accesses a Resource not when the fetch occurs. In so, it is possible to start loading the Component data and lazy load the Component itself at the same time, instead of waiting for the Component to load to start loading the data.

```jsx
// start loading data before any part of the page is executed.
const [state, load] = createResourceState();
load({ user: fetchUser(), posts: fetchPosts() });

function ProfilePage() {
  return (
    <Suspense fallback={<h1>Loading profile...</h1>}>
      <ProfileDetails />
      <Suspense fallback={<h1>Loading posts...</h1>}>
        <ProfileTimeline />
      </Suspense>
    </Suspense>
  );
}

function ProfileDetails() {
  // Try to read user info, although it might not have loaded yet
  return <h1>{state.user?.name}</h1>;
}

function ProfileTimeline() {
  // Try to read posts, although they might not have loaded yet
  return (
    <ul>
      <For each={state.posts}>{post => <li key={post.id}>{post.text}</li>}</For>
    </ul>
  );
}

render(ProfilePage, document.getElementById("app"));
```

## Coordinating Suspense Components with SuspenseList (Experimental)

Sometimes you have multiple `Suspense` Components you wish to coordinate. Sure you could put everything under a single `Suspense` but that limits us to a single loading behavior. A single fallback state and everything always needs to wait until the last thing is loaded. Instead we introduce the `SuspenseList` Component to coordinate. Consider:

```jsx
function ProfilePage(props) {
  return (
    <>
      <ProfileDetails />
      <Suspense fallback={<h1>Loading posts...</h1>}>
        <ProfileTimeline feed={props.feed} />
      </Suspense>
      <Suspense fallback={<h2>Loading fun facts...</h2>}>
        <ProfileTrivia facts={props.facts} />
      </Suspense>
    </>
  );
}
```

If we wrap this with a `SuspenseList` configured with `revealOrder` of `forwards` they will render in the order they appear in the tree regardless of the order they load. This reduces page jumping around. You can set `revealOrder` to `backwards` and `together` as well, which reverse this order, or wait for all Suspense Components to load respectively. In addition there is a `tail` option that can be set to `hidden` or `collapsed`. This overrides the default behavior of showing all fallbacks, with either showing none or showing the next one in the direction set by `revealOrder`.

A `SuspenseList` can contain other `SuspenseList`'s to create flowing tables or grids etc.

```jsx
<SuspenseList revealOrder="forwards" tail="collapsed">
  <ProfileDetails />
  <Suspense fallback={<h1>Loading posts...</h1>}>
    <ProfileTimeline feed={props.feed} />
  </Suspense>
  <Suspense fallback={<h2>Loading fun facts...</h2>}>
    <ProfileTrivia facts={props.facts} />
  </Suspense>
</SuspenseList>
```

> **For React Users:** Again this works a bit different than its React counterpart as it uses the Context API. In so nesting Suspense Components are perfectly fine. However, do not put them under dynamic areas like control flows as order is based on execution so conditional rendering can cause unpredictable behavior. Also unlike the current Suspense implication even if you are not seeing the "next" Suspense element they are all evaluated immediately on render. This unblocking behavior allows further downstream evaluation that currently does not happen in React.
