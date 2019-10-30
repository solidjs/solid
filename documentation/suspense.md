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

## Placeholders

But what if we don't control when the asynchronous action returns and we need to deal with potentially multiple asynchronous actions. This is where Suspense comes in. It inverts the control, so that the child can manage its asynchronous needs and the parent just sets the rules of how to display the fallback content that is shown as these processes complete. Unlike conditional control flow (like the `Deferred` component above) the children get to run and execute their asynchronous actions triggering Suspense rather than pushing the responsibility on the parent. Suspense consists of 3 states:

- normal - This is when no asynchronous actions are being processed and the system is working as normal.
- suspended - This state is entered once asynchronous actions have started but before the delay has run out to show fallback content. In this state the previous content will continue to be visible.
- fallback - This is the fallback content (like a loading spinner) to show in place of the loading if the asynchronous actions have not completed by the time the delay has run out.

The power of Suspense is that deferring loading states a small amount perceptually make things feel like they are loading faster and smoother even if the app is slightly less responsive. To use Suspense you need to use the `Suspense` Component. To allow downstream control flow to listen into Suspense state to properly handle delays, use the `awaitSuspense` transform.

```jsx
import { Suspense, awaitSuspense } from "solid-js/dom";

// delay fallback content for 300ms
<Suspense fallback={<LoadingSpinner />} maxDuration={300}>
  {/* suspense aware switch control flow */}
  <Switch transform={awaitSuspense}>
    <Match when={state.activeTab === 1}>...</Match>
    <Match when={state.activeTab === 2}>...</Match>
    <Match when={state.activeTab === 3}>...</Match>
  </Switch>
</Suspense>;
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
import { Suspense, awaitSuspense } from "solid-js/dom";

const ComponentA = lazy(() => import("./ComponentA"));
const ComponentB = lazy(() => import("./ComponentB"));
const ComponentC = lazy(() => import("./ComponentC"));

const App = () => {
  const [state, setState] = createState({ activeTab: 1 })

  return <Suspense fallback={<LoadingSpinner />} maxDuration={300}>
    <Switch transform={awaitSuspense}>
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
};
```

## Data Loading

The other supported use of Suspense currently is a more general promise resolver, `loadResource`. `loadResource` accepts either a promise or a reactive function expression that returns a promise and returns a state object with properties:
* data - the resolved data from the promise
* error - the error from the promise rejection
* loading - a boolean indicator to whether the promise is currently executing

`loadResource` can be used independent of Suspense if desired. The reactive form is where the power of this method resides, as you can retrigger promise execution on reactive updates, and there is built in promise cancellation. In example below as the `userId` prop updates the API will be queried.

```jsx
import { createState, loadResource } from "solid-js";

const fetchUser = id =>
  fetch(`https://swapi.co/api/people/${id}/`).then(r => r.json());

export default const UserPanel = props => {
  const result = loadResource(() => props.userId && fetchUser(props.userId));

  return <div>
    <Switch>
      <Match when={result.loading}>Loading...</Match>
      <Match when={result.error}>Error: {result.error}</Match>
      <Match when={result.data}>
        <h1>{result.data.name}</h1>
        <ul>
          <li>Height: {result.data.height}</li>
          <li>Mass: {result.data.mass}</li>
          <li>Birth Year: {result.data.birth_year}</li>
        </ul>
      </Match>
    </Switch>
  </div>
}
```
This examples handles the different states. However, you could have Suspense handle the loading state for you instead by wrapping with the `Suspense` Component.

> **For React Users:** At the time of writing this React has settled how their resource API will look. Solid ships with this feature today, and it might differ from what React ultimately lands on.