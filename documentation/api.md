# Core API

### `createState(initValue): [state, setState]`

Creates a new State object and setState pair that can be used to maintain your componenents state. State only triggers update on values changing. Tracking is done by intercepting property access and automatically tracks deep nesting via proxy.

### `createSignal(initialValue, boolean | comparatorFn): [getValueFn, setValueFn]`

This is the smallest and most primitive reactive atom used to track a single value. By default signals always notify on setting a value. You can have it only notify on changes is you pass true to the second parameter. Or a custom comparator can be passed in to indicate whether the values should be considered equal and listeners not notified.

### `createMemo(prev => <code>, initialValue, boolean | comparatorFn): getValueFn`

Creates a readonly signal that recalculates it's value whenever the executed codes dependencies update. By default memos always notify on updating a value. You can have it only notify on changes is you pass true to the second parameter. Or a custom comparator can be passed in to indicate whether the values should be considered equal and listeners not notified.

### `createComputed(prev => <code>, initialValue): void`

Creates a new computation that automatically tracks dependencies and runs immediately. Use this to write to other reactive primitives or to reactively trigger async data loading. 2nd argument is the initial value.

### `createEffect(prev => <code>, initialValue): void`

Creates a new computation that automatically tracks dependencies and runs after render. Ideal for using `ref`s and managing other side effects. 2nd argument is the initial value.

### `onCleanup(() => <code>)`

Registers a cleanup methodthat executes on disposal or recalculation of the current context.

### `createContext(defaultContext): Context`

Creates a new context object that can be used with useContext and the Provider control flow. Default Context is used when no Provider is found above in the hierarchy.

### `useContext(Context): any`

Hook to grab context to allow for deep passing of props with hierarchal resolution of dependencies without having to pass them through each Component function.

# Additional API

The following are not required to build simple applications but allow a lot more power and control.

### `createRoot(disposer => <code>)`

Creates a new non-tracked context that doesn't auto-dispose. All Solid code should be wrapped in one of these top level as they ensure that all memory/computations are freed up.

### `untrack(() => <code>): any`

Ignores tracking any of the dependencies in the executing code block and returns the value.

### `batch(() => <code>): any`

Ensures that all notification of updates within the block happen at the same time to prevent unnecessary recalculation. Solid State's setState method and computations(useEffect, useMemo) automatically wrap their code in a batch.

### `on(...args, (value, prevValue, prevResult) => result): (prev) => value`
`on` is designed to be passed into a computation to make its deps explicit. If more than one dep is passed value and prevValue are arrays.

### `onError((err: any) => <code>)`

Registers a error handler method that executes when child context errors. Only nearest context error handlers execute. Rethrow to trigger up the line.

### `createDeferred(() => <code>, options: { timeoutMs: number }): getValueFn`

Creates memo that only notifies downstream changes when the browser is idle. `timeoutMS` is the maximum time to wait before forcing the update.

### `createSelector(() => <code>, comparatorFn?): (key) => boolean`

Creates a conditional signal that only notifies subscribers when entering or exiting their key matching the value. Useful for delegated selection state.

### `createResource(initialValue, options: { name }): [getValueFn, loadFn]`

Creates a new resource signal that can hold a async resource. Resources when read while loading trigger Suspense. The `loadFn` takes a promise whose resolved value is set in the resource.

### `createResourceState(initialValue, options: { name }): [state, loadState, setState]`

Creates a new Resource State object. Similar to normal state except each immediate property is a resource.

### `lazy(() => <Promise>): Component`

Used to lazy load components to allow for things like code splitting and Suspense.

### `useTransition(): [isPending, startTransition]`

Used to batch async updates deferring commit until all async processes are complete.

### `assignProps(target, ...sources): target`

A reactive object `assign` method. Useful for setting default props for components in case caller doesn't provide them. Or cloning the props object including reactive properties.

### `splitProps(props, ...keyArrays): [...splitProps]`

Splits a reactive object by keys while maintaining reactivity.