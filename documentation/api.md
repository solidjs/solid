# API

## root(disposer => <code>)

Creates a new non-tracked context that doesn't auto-dispose. All Solid code should be wrapped in one of these top level as they ensure that all memory/computations are freed up.

## useState(initValue): [state, setState]

Creates a new State object and setState pair that can be used to maintain your componenents state.

## useEffect(() => <code>, dependencies, defer)

Creates a new effect that automatically tracks dependencies. The 2nd optional argument is an explicit array of dependencies. The 3rd optional argument is whether to defer initial execution of the effect until a value has changed (this only works with explicit dependencies).

## useSignal(initialValue): signal

Creates a new signal that can be used for reactive tracking.

## useMemo(prev => <code>, initialValue): signal

Creates a readonly signal that recalculates it's value whenever the executed codes dependencies update.

## useCleanup(() => <code>)

Registers a cleanup method that performs that executes on disposal or recalculation of the current context.