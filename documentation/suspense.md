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

## Placeholders & Transitions

But what if we don't control when the asynchronous action returns and we need to deal with potentially multiple asynchronous actions. This is where Suspense comes in. It inverts the control, so that the child can manage its asynchronous needs and the parent just sets the rules of how to display the fallback content that is shown as these processes complete. Unlike conditional control flow (like the `Deferred` component above) the children are not blocked and get execute their asynchronous actions triggering Suspense rather than pushing the responsibility on the parent. Suspense consists of 3 states:

- normal - This is when no asynchronous actions are being processed and the system is working as normal.
- suspended - This state is entered once asynchronous actions have started but before a delay has run out to show fallback content. In this state the previous content will continue to be visible.
- fallback - This is the fallback content (like a loading spinner) to show in place of the loading if the asynchronous actions have not completed by the time the delay has run out.

Consider the simple case of switching between 3 tabs which have asynchronous loaded tabs. To use Suspense you need to use the `Suspense` Component to wrap the asynchronous activity.

```jsx
import { createState } from "solid-js";
import { Suspense } from "solid-js/dom";

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

The power of Suspense is that deferring loading states a small amount perceptually make things feel like they are loading faster and smoother even if the app is slightly less responsive. The key to handling these deferred updates is to define a transition with `useTransition`. It returns a method to wrap state updates that can be deferred and an method that tracks whether the transition is currently active. When control flow is suspended it continues to show the current branch while rendering the next off screen. It is important to note that once suspense has triggered the onscreen content within this flow will no longer update.

```jsx
import { createState, useTransition } from "solid-js";
import { Suspense } from "solid-js/dom";

function App() {
  const [state, setState] = createState({ activeTab: 1 }),
    // delay showing fallback for up to 500ms
    [isPending, startTransition] = useTransition({ timeoutMs: 500 });

  return (
    <>
      <ul disabled={isPending()}>
        <li onClick={() => startTransition(() => setState({ activeTab: 1 }))}>
          Tab1
        </li>
        <li onClick={() => startTransition(() => setState({ activeTab: 2 }))}>
          Tab2
        </li>
        <li onClick={() => startTransition(() => setState({ activeTab: 3 }))}>
          Tab3
        </li>
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

> **For React Users:** Given the nature of Solid's Reactive system, the throw a promise approach React uses doesn't make sense here. React just re-runs that part of the tree again, whereas Solid cannot pickup from where it left off. Instead Solid's Suspense mechanism ties into the Context API. Like React it is the closest Suspense Component that handles the Suspense state. However, unlike React when in transition there is no way to update control flow suspended blocks. Either the value updates immediately or it is a new branch being rendered offscreen. In practice this is hardly noticeable difference as the parts of the screen not inside are unaffected, and generally when something is exiting the page it is intentional the end user doesn't interact with it.

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
import { Suspense } from "solid-js/dom";

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

Solid ships with a general promise resolver, `load`. `load` accepts reactive function expression that returns a promise, and handler functions for success and failure cases. While not necessary to use with Solid or Suspense the power of this method resides in its reactivity, as you can retrigger promise execution on reactive updates, and there is built in promise cancellation. In example below as the `userId` prop updates the API will be queried.

```jsx
import { load, createState } from "solid-js";

const fetchUser = id =>
  fetch(`https://swapi.co/api/people/${id}/`).then(r => r.json());

export default const UserPanel = props => {
  const [state, setState] = createState(),
    [loading, reload] = load(
      () => props.userId && fetchUser(props.userId),
      value => setState({value}),
      (error, failedAttempts) => {
        // retry up to 3 times with linear backoff
        if (error && failedAttempts <= 3) {
          setTimeout(reload, failedAttempts * 500);
          return true;
        }
      }
    );

  return <div>
    <Switch fallback={"Failed to load User"}>
      <Match when={loading()}>Loading...</Match>
      <Match when={state.value}>
        <h1>{state.value.name}</h1>
        <ul>
          <li>Height: {state.value.height}</li>
          <li>Mass: {state.value.mass}</li>
          <li>Birth Year: {state.value.birthYear}</li>
        </ul>
      </Match>
    </Switch>
  </div>
}
```

This examples handles the different loading states. However, you can expand this example to use Suspense instead by wrapping with the `Suspense` Component, and writing to a Resource. A Resource is a special Signal or State Object that triggers Suspense on read when the value is not present.

> **For React Users:** At the time of writing this React has not completely settled how their Data Fetching API will look. Solid ships with this feature today, and it might differ from what React ultimately lands on.

## Render as you Fetch

It is important to note that Suspense is tracked based on data requirements of the the reactive graph not the fact data is being fetched. Suspense is inacted when a child of a Suspense Component accesses a Resource not when the fetch occurs. In so, it is possible to start loading the Component data and lazy load the Component itself at the same time, instead of waiting for the Component to load to start loading the data.

```jsx
// start loading data before any part of the page is executed.
const [state, setState] = createResourceState(["user", "posts"])
load(() => /* fetch user & posts */, setState);

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
  return <h1>{state.user && state.user.name}</h1>;
}

function ProfileTimeline() {
  // Try to read posts, although they might not have loaded yet
  return (
    <ul>
      <For each={state.posts}>{post => (
        <li key={post.id}>{post.text}</li>
      )}</For>
    </ul>
  );
}

render(ProfilePage, document.body);
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

> **For React Users:** Again this works a bit different than its React counterpart as it uses the Context API. In so nesting Suspense Components are perfectly fine. However, do not put them under dynamic areas like control flows as order is based on execution so conditional rendering can cause unpredictable behavior. Also unlike the current Suspense implication even if you are not seeing the "next" Suspense element they are all evaluated immediately on render. This unblocking behavior allows further downstream evaluation that currently does not happen in React.
