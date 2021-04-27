# Core API

### `createSignal(initialValue, { equals, name }): [getValueFn, setValue]`

This is the smallest and most primitive reactive atom used to track a single value. The create function returns a get and set pair of functions to access and update the signal.

### `createState(initValue, { name }): [state, setState]`

This creates a tree of signals as proxy that allows individual values in nested data structures to be independently tracked. The create function returns a readonly proxy object, and a state setter function.

### `createMemo(prev => <code>, initialValue, { equals, name }): getValueFn`

Creates a readonly derived signal that recalculates it's value whenever the executed codes dependencies update.

### `createEffect(prev => <code>, initialValue, { name }): void`

Creates a new computation that automatically tracks dependencies and runs after each render where a dependency has changed. Ideal for using `ref`s and managing other side effects. 2nd argument is the initial value.

### `createResource(fetcher, { initialValue, name }): [getValueFn, { mutate, refetch }]`
### `createResource(source, fetcher, { initialValue, name }): [getValueFn, { mutate, refetch }]`

Creates a new resource signal that can manage async requests. The `fetcher` is a function that accepts return value of the `source` if provided and returns a Promise whose resolved value is set in the resource. The fetcher is not reactive so use the optional first argument if you want it to run more than once. If the source resolves to false, null, or undefined will not to fetch.

### `onMount(() => <code>)`

Registers a method that runs after initial render and elements have been mounted. Ideal for using `ref`s and managing other one time side effects. It is equivalent to a `createEffect` which does not have any dependencies.

### `onCleanup(() => <code>)`

Registers a cleanup method that executes on disposal or recalculation of the current reactive scope. Can be used in any component or computation.

# Additional API

The following are not required to build simple applications but allow a lot more power and control.

### `createContext(defaultContext): Context`

Creates a new context object that can be used with useContext and the Provider control flow. Default Context is used when no Provider is found above in the hierarchy.

### `useContext(Context): any`

Hook to grab context to allow for deep passing of props with hierarchal resolution of dependencies without having to pass them through each Component function.

### `untrack(() => <code>): any`

Ignores tracking any of the dependencies in the executing code block and returns the value.

### `batch(() => <code>): any`

Ensures that all notification of updates within the block happen at the same time to prevent unnecessary recalculation. Solid State's setState method and computations(useEffect, useMemo) automatically wrap their code in a batch.

### `on(...args, (value, prevValue, prevResult) => result): (prev) => value`

`on` is designed to be passed into a computation to make its deps explicit. If more than one dep is passed, value and prevValue are arrays.

### `onError((err: any) => <code>)`

Registers an error handler method that executes when child context errors. Only nearest context error handlers execute. Rethrow to trigger up the line.

### `createRoot(disposer => <code>)`

Creates a new non-tracked context that doesn't auto-dispose. All Solid code should be wrapped in one of these top level as they ensure that all memory/computations are freed up.
### `createMutable(initValue): state`

Creates a new mutable State proxy object. State only triggers update on values changing. Tracking is done by intercepting property access and automatically tracks deep nesting via proxy.

### `createDeferred(() => <code>, options: { timeoutMs: number }): getValueFn`

Creates memo that only notifies downstream changes when the browser is idle. `timeoutMs` is the maximum time to wait before forcing the update.

### `createComputed(prev => <code>, initialValue): void`

Creates a new computation that automatically tracks dependencies and runs immediately. Use this to write to other reactive primitives. 2nd argument is the initial value.

### `createRenderEffect(prev => <code>, initialValue): void`

Creates a new computation that automatically tracks dependencies and runs during the render phase as DOM elements are created and updated but not necessarily connected. All internal DOM updates happen at this time.

### `createSelector(() => <code>, comparatorFn?): (key) => boolean`

Creates a conditional signal that only notifies subscribers when entering or exiting their key matching the value. Useful for delegated selection state.

### `lazy(() => <Promise>): Component`

Used to lazy load components to allow for things like code splitting and Suspense.

### `useTransition(): [isPending, startTransition]`

Used to batch async updates deferring commit until all async processes are complete.

### `mergeProps(...sources): target`

A reactive object `merge` method. Useful for setting default props for components in case caller doesn't provide them. Or cloning the props object including reactive properties.

### `splitProps(props, ...keyArrays): [...splitProps]`

Splits a reactive object by keys while maintaining reactivity.
