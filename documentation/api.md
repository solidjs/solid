# API

### `createRoot(disposer => <code>)`

Creates a new non-tracked context that doesn't auto-dispose. All Solid code should be wrapped in one of these top level as they ensure that all memory/computations are freed up.

### `createState(initValue): [state, setState]`

Creates a new State object and setState pair that can be used to maintain your componenents state.

### `createEffect(prev => <code>, initialValue): void`

Creates a new effect that automatically tracks dependencies. 2nd argument is the initial value.

### `createSignal(initialValue, comparatorFn): [getValueFn, setValueFn]`

Creates a new signal that can be used for reactive tracking. By default signals always notify on setting a value. However a comparator can be passed in to indicate whether the values should be considered equal and listeners not notified.

### `createMemo(prev => <code>, initialValue, comparatorFn): getValueFn`

Creates a readonly signal that recalculates it's value whenever the executed codes dependencies update. Memos only notify dependents when returned value changes. You can also set a custom comparator.

### `createDeferred(prev => <code>, options: { timeoutMs: number }): getValueFn`

Creates memo that only notifies downstream changes when the browser is idle. `timeoutMS` is the maximum time to wait before forcing the update.

### `createDependentEffect(() => <code>, dependencies, defer): void`

Creates a new effect that explicitly tracks dependencies. The 2nd optional argument is an explicit array of dependencies. The 3rd optional argument is whether to defer initial execution of the effect until a value has changed (this only works with explicit dependencies).

### `onCleanup((final: boolean) => <code>)`

Registers a cleanup method that performs that executes on disposal or recalculation of the current context.

### `afterEffects(() => <code>)`

Registers a method that will run after the current execution process is complete. These are useful when waiting on refs to resolves or child DOM nodes to render.

### `sample(() => <code>): any`

Ignores tracking any of the dependencies in the executing code block and returns the value.

### `freeze(() => <code>): any`

Ensures that all updates within the block happen at the same time to prevent unnecessary recalculation. Solid State's setState method and computations(useEffect, useMemo) automatically wrap their code in freeze blocks.

### `createContext(defaultContext): Context`

Creates a new context object that can be used with useContext and the Provider control flow. Default Context is used when no Provider is found above in the hierarchy.

### `useContext(Context): any`

Hook to grab context to allow for deep passing of props with hierarchal resolution of dependencies without having to pass them through each Component function.

### `lazy(() => <Promise>): Component`

Used to lazy load components to allow for things like code splitting and Suspense.

### `loadResource(() => <Promise>): { value, error, loading, failedAttempts, reload }`

Creates a memo that updates when promise is resolved. It tracks dependency changes to retrigger. This works with the Suspend control flow.

### `setDefaults(props, defaultProps): void`

Sets default props for function components in case caller doesn't provide them.
