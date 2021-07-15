# 响应式基础

## `createSignal`

```ts
export function createSignal<T>(
  value: T,
  options?: { name?: string; equals?: false | ((prev: T, next: T) => boolean) }
): [get: () => T, set: (v: T) => T];
```

这是最基本的响应式 primitive，用于跟踪后续可能变化的单个值。 create 函数返回一对 get 和 set 函数来访问和更新 signal。

```js
const [getValue, setValue] = createSignal(initialValue);

// 读取值
getValue();

// 设置值
setValue(nextValue);

// 使用 setter 函数设置值
setValue(prev => prev + next);
```

如果你希望值对更新做出响应，请记住在跟踪范围内访问信号。 跟踪范围是指可以被传递然后计算的函数之内，如 `createEffect` 或 JSX 表达式。

> 如果您希望在 Signal 中存储函数，则必须使用函数的形式：
>
> ```js
> setValue(() => myFunction);
> ```

## `createEffect`

```ts
export function createEffect<T>(fn: (v: T) => T, value?: T, options?: { name?: string }): void;
```

创建一个新的计算来自动跟踪依赖项并在每次依赖项发生变化导致的渲染之后运行。 非常适合使用 `ref` 或者管理其他副作用。

```js
const [a, setA] = createSignal(initialValue);

// 依赖于 signal `a` 的 effect
createEffect(() => doSideEffect(a()));
```

effect 函数可以拿到上次执行返回的值。 可以在第二个可选参数设置该值得初始化值。 这可以让我们不用创建额外闭包的情况下就可以进行差异对比。

```js
createEffect(prev => {
  const sum = a() + b();
  if (sum !== prev) console.log(sum);
  return sum;
}, 0);
```

## `createMemo`

```ts
export function createMemo<T>(
  fn: (v: T) => T,
  value?: T,
  options?: { name?: string; equals?: false | ((prev: T, next: T) => boolean) }
): () => T;
```

创建一个只读派生的 signal，每当执行代码的依赖项被更新时，该 signal 就会重新计算其值。

```js
const getValue = createMemo(() => computeExpensiveValue(a(), b()));

// 读取
getValue();
```

使用 memo 函数上次执行返回的值调用 memo 函数。 该值可以初始化为可选的第二个参数。 这对于减少计算很有用。

```js
const sum = createMemo(prev => input() + prev, 0);
```

## `createResource`

```ts
type ResourceReturn<T> = [
  {
    (): T | undefined;
    loading: boolean;
    error: any;
  },
  {
    mutate: (v: T | undefined) => T | undefined;
    refetch: () => void;
  }
];

export function createResource<T, U = true>(
  fetcher: (k: U, getPrev: () => T | undefined) => T | Promise<T>,
  options?: { initialValue?: T; name?: string }
): ResourceReturn<T>;

export function createResource<T, U>(
  source: U | false | null | (() => U | false | null),
  fetcher: (k: U, getPrev: () => T | undefined) => T | Promise<T>,
  options?: { initialValue?: T; name?: string }
): ResourceReturn<T>;
```

创建一个可以管理异步请求的 signal。 `fetcher` 是一个异步函数，它接收 `source` 的返回值（如果提供）并返回一个 Promise，其解析值设置在 resource 中。 fetcher 不是响应式的，因此如果希望它运行多次，请传入第一个可选参数。 如果源解析为 false、null 或 undefined，则不会执行获取操作。

```js
const [data, { mutate, refetch }] = createResource(getQuery, fetchData);

// 读取值
data();

// 检查是否加载中
data.loading;

// 检查是否加载错误
data.error;

// 无需创建 promise 直接设置值
mutate(optimisticValue);

// 重新执行最后的请求
refetch();
```

`loading` 和 `error` 是响应式 getter，可以被跟踪。

# 生命周期

## `onMount`

```ts
export function onMount(fn: () => void): void;
```

注册一个在初始话化渲染和元素挂载完成后运行的方法。 非常适合使用 `ref` 或者管理其他的一次性副作用。 它相当于一个没有任何依赖的 `createEffect`。

## `onCleanup`

```ts
export function onCleanup(fn: () => void): void;
```

注册一个清理方法，它会在当前响应范围内执行销毁或重新计算时候被触发。可用于任何组件或 Effect。

## `onError`

```ts
export function onError(fn: (err: any) => void): void;
```

注册一个错误处理函数，它会在子作用域抛出错误时执行。但是最近的范围的错误处理函数才会执行。重新抛出可以向上触发。

# 响应式工具函数

有了这些工具函数，我们可以更好地调度更新以及控制响应式跟踪行为。

## `untrack`

```ts
export function untrack<T>(fn: () => T): T;
```

忽略跟踪执行代码块中的任何依赖项并返回值。

## `batch`

```ts
export function batch<T>(fn: () => T): T;
```

暂持块作用域内提交的更新直到块作用域结束以避免不必要的重新计算。这意味着下一行的读取到的值还没有被更新。Solid Store 的 set 方法和 Effect 会自动将它们的代码打包成一个批次来进行更新。

## `on`

```ts
export function on<T extends Array<() => any> | (() => any), U>(
  deps: T,
  fn: (input: T, prevInput: T, prevValue?: U) => U,
  options: { defer?: boolean } = {}
): (prevValue?: U) => U | undefined;
```

`on` 主要用来将其传递到计算行为中以使其依赖项更加清晰明了。 如果传递依赖项是数组，则 `input` 和 `prevInput` 也是数组。

```js
createEffect(on(a, v => console.log(v, b())));

// 等同于
createEffect(() => {
  const v = a();
  untrack(() => console.log(v, b()));
});
```

您也可以不用立即执行计算，而是通过将 defer 选项设置为 true 来选择仅在更改时运行计算。

```js
// 不会立即运行
createEffect(on(a, v => console.log(v), { defer: true }));

setA("new"); // 现在会运行了
```

## `createRoot`

```ts
export function createRoot<T>(fn: (dispose: () => void) => T): T;
```

创建一个崭新的，不自动处理的，非跟踪上下文。在嵌套响应式上下文的情况下，如果你不希望在父级重新求值时释放资源这个特性会很有用。这是一种强大的缓存模式。

所有 Solid 代码都应被 createRoot 包裹，因为它们确保释放所有内存/计算。 通常你不需要担心这个，因为 `createRoot` 被嵌入到所有的 `render` 入口函数中。

## `mergeProps`

```ts
export function mergeProps(...sources: any): any;
```

响应式对象的合并 `merge` 方法。用于为组件设置默认 props 以防调用者不提供这些属性值。或者克隆包含响应式的属性的 props 对象。

此方法的运作原理是使用代理并以相反的顺序解析属性。这可以对首次合并 props 对象时不存在的属性进行动态跟踪。

```js
// 设置默认 props
props = mergeProps({ name: "Smith" }, props);

// 克隆 props
newProps = mergeProps(props);

// 合并 props
props = mergeProps(props, otherProps);
```

## `splitProps`

```ts
export function splitProps<T>(props: T, ...keys: Array<(keyof T)[]>): [...parts: Partial<T>];
```

This is the replacement for destructuring. It splits a reactive object by keys while maintaining reactivity.

这是解构的替代品。 `splitProps` 在保持响应性的同时通过键来拆分响应式对象。

```js
const [local, others] = splitProps(props, ["children"]);

<>
  <Child {...others} />
  <div>{local.children}<div>
</>
```

## `useTransition`

```ts
export function useTransition(): [() => boolean, (fn: () => void, cb?: () => void) => void];
```

用于在所有异步处理完成后在延迟提交事务中批量异步更新。 这与 Suspense 有所关联，并且仅跟踪在 Suspense 边界下读取的资源。

```js
const [isPending, start] = useTransition();

// 检查是否在 transition 中
isPending();

// 包裹在 transition 中
start(() => setSignal(newValue), () => /* transition 完成 */)
```

## `observable`

```ts
export function observable<T>(input: () => T): Observable<T>;
```

这个方法接受一个 signal 并产生一个简单的 Observable。从你选择的 Observable 库中使用它，通常使用 `from` 操作符。

```js
import { from } from "rxjs";

const [s, set] = createSignal(0);

const obsv$ = from(observable(s));

obsv$.subscribe(v => console.log(v));
```

## `mapArray`

```ts
export function mapArray<T, U>(
  list: () => readonly T[],
  mapFn: (v: T, i: () => number) => U
): () => U[];
```

响应式映射工具函数，通过引用缓存每个子项，以减少不必要的映射更新。它只为每个值运行一次映射函数，然后根据需要移动或删除它。index 参数是一个 signal。映射函数本身没有被跟踪。

`mapArray` 也是`<For>` 组件控制流程的底层工具函数

```js
const mapped = mapArray(source, (model) => {
  const [name, setName] = createSignal(model.name);
  const [description, setDescription] = createSignal(model.description);

  return {
    id: model.id,
    get name() {
      return name();
    },
    get description() {
      return description();
    }
    setName,
    setDescription
  }
});
```

## `indexArray`

```ts
export function indexArray<T, U>(
  list: () => readonly T[],
  mapFn: (v: () => T, i: number) => U
): () => U[];
```

类似于 `mapArray`，除了它按索引映射。每个子项都是 signal，索引是常量。

`indexArray` 也是 `<Index>` 组件控制流程的底层工具函数

```js
const mapped = indexArray(source, (model) => {
  return {
    get id() {
      return model().id
    }
    get firstInitial() {
      return model().firstName[0];
    },
    get fullName() {
      return `${model().firstName} ${model().lastName}`;
    },
  }
});
```

# 状态存储

以下 API 可以从`solid-js/store` 导入。

## `createStore`

```ts
export function createStore<T extends StoreNode>(
  state: T | Store<T>,
  options?: { name?: string }
): [get: Store<T>, set: SetStoreFunction<T>];
```

`createStore` 创建一个 Signal 树作为代理，允许独立跟踪嵌套数据结构中的各个值。 create 函数返回一个只读代理对象和一个 setter 函数。

```js
const [state, setState] = createStore(initialValue);

// 读取值
state.someValue;

// 设置值
setState({ merge: "thisValue" });

setState("path", "to", "value", newValue);
```

Store 代理对象仅跟踪访问的属性。并在访问 Store 时递归地生成嵌套数据上的嵌套 Store 对象。但是它只包装数组和普通对象。类不包装。 所以像 `Date`、`HTMLElement`、`Regexp`、`Map`、`Set` 之类的东西都不是响应式粒度的。此外，如果不访问对象上的属性，则无法跟踪顶级状态对象。因此它不适用于迭代对象，因为添加新键或索引无法触发更新。因此，将数组放在键上，而不是尝试使用状态对象本身。

```js
// 将列表作为状态对象的键
const [state, setState] = createStore({ list: [] });

// 访问 state 对象上的 `list` 属性
<For each={state.list}>{item => /*...*/}</For>
```

### Getters

Store 对象支持使用 getter 来存储计算值。

```js
const [state, setState] = createStore({
  user: {
    firstName: "John",
    lastName: "Smith",
    get fullName() {
      return `${this.firstName} ${this.lastName}`;
    }
  }
});
```

以下是简单的 getter，所以如果你想缓存一个值，你仍然需要使用 Memo；

```js
let fullName;
const [state, setState] = createStore({
  user: {
    firstName: "John",
    lastName: "Smith",
    get fullName() {
      return fullName();
    }
  }
});
fullName = createMemo(() => `${state.firstName} ${state.lastName}`);
```

### 更新 Store

更改状态可以采用传递先前状态并返回新状态或值的函数的形式。对象总是浅合并的。将值设置为 `undefined` 以将属性从 Store 中删除。

```js
const [state, setState] = createStore({ firstName: "John", lastName: "Miller" });

setState({ firstName: "Johnny", middleName: "Lee" });
// ({ firstName: 'Johnny', middleName: 'Lee', lastName: 'Miller' })

setState(state => ({ preferredName: state.firstName, lastName: "Milner" }));
// ({ firstName: 'Johnny', preferredName: 'Johnny', middleName: 'Lee', lastName: 'Milner' })
```

setState 支持的路径包括键数组、对象范围和过滤器函数。

setState 还支持嵌套设置，你可以在其中指明要修改的路径。在嵌套的情况下，要更新的状态可能是非对象值。对象仍然合并，但其他值（包括数组）将会被替换。

```js
const [state, setState] = createStore({
  counter: 2,
  list: [
    { id: 23, title: 'Birds' }
    { id: 27, title: 'Fish' }
  ]
});

setState('counter', c => c + 1);
setState('list', l => [...l, {id: 43, title: 'Marsupials'}]);
setState('list', 2, 'read', true);
// {
//   counter: 3,
//   list: [
//     { id: 23, title: 'Birds' }
//     { id: 27, title: 'Fish' }
//     { id: 43, title: 'Marsupials', read: true }
//   ]
// }
```

路径可以是字符串键、键数组、迭代对象（{from、to、by}）或过滤器函数。这为描述状态变化提供了令人难以置信的表达能力。

```js
const [state, setState] = createStore({
  todos: [
    { task: 'Finish work', completed: false }
    { task: 'Go grocery shopping', completed: false }
    { task: 'Make dinner', completed: false }
  ]
});

setState('todos', [0, 2], 'completed', true);
// {
//   todos: [
//     { task: 'Finish work', completed: true }
//     { task: 'Go grocery shopping', completed: false }
//     { task: 'Make dinner', completed: true }
//   ]
// }

setState('todos', { from: 0, to: 1 }, 'completed', c => !c);
// {
//   todos: [
//     { task: 'Finish work', completed: false }
//     { task: 'Go grocery shopping', completed: true }
//     { task: 'Make dinner', completed: true }
//   ]
// }

setState('todos', todo => todo.completed, 'task', t => t + '!')
// {
//   todos: [
//     { task: 'Finish work', completed: false }
//     { task: 'Go grocery shopping!', completed: true }
//     { task: 'Make dinner!', completed: true }
//   ]
// }

setState('todos', {}, todo => ({ marked: true, completed: !todo.completed }))
// {
//   todos: [
//     { task: 'Finish work', completed: true, marked: true }
//     { task: 'Go grocery shopping!', completed: false, marked: true }
//     { task: 'Make dinner!', completed: false, marked: true }
//   ]
// }
```

## `produce`

```ts
export function produce<T>(
  fn: (state: T) => void
): (state: T extends NotWrappable ? T : Store<T>) => T extends NotWrappable ? T : Store<T>;
```

Immer 启发了 Solid 的 Store 对象的 `produce` API，它允许本地修改状态。

```js
setState(
  produce(s => {
    s.user.name = "Frank";
    s.list.push("Pencil Crayon");
  })
);
```

## `reconcile`

```ts
export function reconcile<T>(
  value: T | Store<T>,
  options?: {
    key?: string | null;
    merge?: boolean;
  } = { key: "id" }
): (state: T extends NotWrappable ? T : Store<T>) => T extends NotWrappable ? T : Store<T>;
```

当对比数据变更时，我们不能应用粒度更新。`reconcile` 在处理来自 store 或巨大 API 响应这些不可变数据时很有用。

该键在可用于匹配项目时使用。默认情况下，`merge` 为 `false` 会在可能的情况下进行引用检查以确定相等，并替换不引用相等的数据。`merge` 为 `true` 时，`reconcile` 会将所有差异推送到叶子节点，并高效地将先前的数据修改为新值。

```js
// 订阅一个 observable
const unsubscribe = store.subscribe(({ todos }) => (
  setState('todos', reconcile(todos)));
);
onCleanup(() => unsubscribe());
```

## `createMutable`

```ts
export function createMutable<T extends StoreNode>(
  state: T | Store<T>,
  options?: { name?: string }
): Store<T> {
```

`createMutable` 创建一个新的可变 Store 代理对象。Store 仅在值更改时触发更新。跟踪是通过拦截属性访问来完成的，并通过代理自动跟踪深度嵌套数据。

`createMutable` 用于集成外部系统或作为与 MobX/Vue 的兼容层会很有用。

> **注意：** 由于可变状态可以在任何地方传递和修改，这会使其更难以遵循并且更容易打破单向流，因此通常建议使用 `createStore` 代替。 `produce` 修饰符可以提供许多相同的好处而没有任何缺点。

```js
const state = createMutable(initialValue);

// 读取值
state.someValue;

// 设置值
state.someValue = 5;

state.list.push(anotherValue);
```

Mutables 支持同时设置 setter 和 getter。

```js
const user = createMutable({
  firstName: "John",
  lastName: "Smith",
  get fullName() {
    return `${this.firstName} ${this.lastName}`;
  },
  set fullName(value) {
    [this.firstName, this.lastName] = value.split(" ");
  }
});
```

# 组件 API

## `createContext`

```ts
interface Context<T> {
  id: symbol;
  Provider: (props: { value: T; children: any }) => any;
  defaultValue: T;
}
export function createContext<T>(defaultValue?: T): Context<T | undefined>;
```

在 Solid 中，Context 提供了一种依赖注入的形式。它可以用来避免需要通过中间组件将数据作为 props 传递的情况。

该函数创建了一个新的上下文对象，可以通过 `useContext` 来使用，并提供 `Provider` 控制流。当在层次结构的上方找不到 `Provider` 时，将使用默认上下文。

```js
export const CounterContext = createContext([{ count: 0 }, {}]);

export function CounterProvider(props) {
  const [state, setState] = createStore({ count: props.count || 0 });
  const store = [
    state,
    {
      increment() {
        setState("count", c => c + 1);
      },
      decrement() {
        setState("count", c => c - 1);
      }
    }
  ];

  return <CounterContext.Provider value={store}>{props.children}</CounterContext.Provider>;
}
```

传递给 provider 的值按原样传递给 `useContext`。 这意味着包装为响应性的表达式将不起作用。 你应该直接传入 Signal 和 Store，而不是在 JSX 中访问它们。

## `useContext`

```ts
export function useContext<T>(context: Context<T>): T;
```

用于获取上下文以允许深层传递 props，而不必通过每个组件函数传递它们。

```js
const [state, { increment, decrement }] = useContext(CounterContext);
```

## `children`

```ts
export function children(fn: () => any): () => any;
```

Used to make it easier to interact with `props.children`. This helper resolves any nested reactivity and returns a memo. Recommended approach to using `props.children` in anything other than passing directly through to JSX.

用于更容易地与`props.children`交互。 这个工具函数解决层级嵌套的响应性并返回一个 Memo。 除了直接传递值给 JSX 这种情况之外，推荐使用 `props.children` 的方法。

```js
const list = children(() => props.children);

// 用 list 做点什么 
createEffect(() => list());
```

## `lazy`

```ts
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>
): T & { preload: () => Promise<T> };
```

用于延迟加载组件以允许代码拆分。组件在渲染之前不会加载。延迟加载的组件可以与静态导入的组件同样使用，接收 props 等...... 延迟加载的组件还会触发 `<Suspense>`。

```js
// 保证导入
const ComponentA = lazy(() => import("./ComponentA"));

// 在 JSX 中使用
<ComponentA title={props.title} />;
```

# 第二 Primitive

您的第一个 app 可能不需要它们，但这些有用的工具也不可或缺。

## `createDeferred`

```ts
export function createDeferred<T>(
  source: () => T,
  options?: { timeoutMs?: number; name?: string; equals?: false | ((prev: T, next: T) => boolean) }
): () => T;
```

创建只读值，仅在浏览器空闲时通知下游变更。`timeoutMs` 是强制更新前等待的最长时间。

## `createComputed`

```ts
export function createComputed<T>(fn: (v: T) => T, value?: T, options?: { name?: string }): void;
```

创建一个新的计算，自动跟踪依赖关系并在渲染之前立即运行。使用它来编写其他响应式 primitive。如果可能，请使用 `createMemo` 代替，因为写入中间更新的 signal 可能会导致其他计算需要重新计算。

## `createRenderEffect`

```ts
export function createRenderEffect<T>(
  fn: (v: T) => T,
  value?: T,
  options?: { name?: string }
): void;
```

创建一个新的计算，自动跟踪依赖项并在渲染阶段运行，因为 DOM 元素被创建和更新但不一定连接。所有内部 DOM 更新都在此时发生。

## `createSelector`

```ts
export function createSelector<T, U>(
  source: () => T,
  fn?: (a: U, b: T) => boolean,
  options?: { name?: string }
): (k: U) => boolean;
```

创建一个条件 signal，仅在进入或退出时键与值匹配时通知订阅者。处理委托选择状态很有用。因为它使得操作复杂度是 O(2) 而不是 O(n)。

```js
const isSelected = createSelector(selectedId);

<For each={list()}>{item => <li classList={{ active: isSelected(item.id) }}>{item.name}</li>}</For>;
```

# 渲染

These imports are exposed from `solid-js/web`.

以下导入是从 `solid-js/web` 暴露的。

## `render`

```ts
export function render(code: () => JSX.Element, element: MountableElement): () => void;
```

`render` 是浏览器应用程序入口点。它需要提供顶级组件定义或函数以及需要挂载的元素。建议该元素为空，因为返回的 dispose 函数将清理所有子元素。

```js
const dispose = render(App, document.getElementById("app"));
```

## `hydrate`

```ts
export function hydrate(fn: () => JSX.Element, node: MountableElement): () => void;
```

此方法类似于 `render`，只是它会尝试重新注水到已经渲染到 DOM 的内容。在浏览器中初始化时，页面已被服务器渲染。

```js
const dispose = hydrate(App, document.getElementById("app"));
```

## `renderToString`

```ts
export function renderToString<T>(
  fn: () => T,
  options?: {
    eventNames?: string[];
    nonce?: string;
  }
): string;
```

同步渲染为字符串。该函数还为渐进式注水生成脚本标签。选项包括在页面加载之前侦听并在注水时回放的 eventNames，以及放在脚本标签上的 nonce。

```js
const html = renderToString(App);
```

## `renderToStringAsync`

```ts
export function renderToStringAsync<T>(
  fn: () => T,
  options?: {
    eventNames?: string[];
    timeoutMs?: number;
    nonce?: string;
  }
): Promise<string>;
```

与 `renderToString` 相同，除了它在返回结果之前会等待所有 `<Suspense>` 边界解析。资源数据会自动序列化到脚本标签中，并会在客户端加载时注水。

```js
const html = await renderToStringAsync(App);
```

## `pipeToNodeWritable`

```ts
export type PipeToWritableResults = {
  startWriting: () => void;
  write: (v: string) => void;
  abort: () => void;
};
export function pipeToNodeWritable<T>(
  fn: () => T,
  writable: { write: (v: string) => void },
  options?: {
    eventNames?: string[];
    nonce?: string;
    noScript?: boolean;
    onReady?: (r: PipeToWritableResults) => void;
    onComplete?: (r: PipeToWritableResults) => void | Promise<void>;
  }
): void;
```

此方法渲染出 Node 流。它同步渲染内容，包括任何 Suspense 回退占位符，然后在完成时继续从任何异步资源流式传输数据。

```js
pipeToNodeWritable(App, res);
```

`onReady` 选项用来写入核心应用程序渲染的流很有用。请记住，如果你想要使用 `onReady` 手动调用 `startWriting` 的话。

## `pipeToWritable`

```ts
export type PipeToWritableResults = {
  write: (v: string) => void;
  abort: () => void;
  script: string;
};
export function pipeToWritable<T>(
  fn: () => T,
  writable: WritableStream,
  options?: {
    eventNames?: string[];
    nonce?: string;
    noScript?: boolean;
    onReady?: (writable: { write: (v: string) => void }, r: PipeToWritableResults) => void;
    onComplete?: (writable: { write: (v: string) => void }, r: PipeToWritableResults) => void;
  }
): void;
```

此方法渲染到 Web 流。 它同步渲染内容，包括任何 Suspense 回退占位符，然后在完成时继续从任何异步资源流式传输数据。

```js
const { readable, writable } = new TransformStream();
pipeToWritable(App, writable);
```

`onReady` 选项对于写入围绕核心应用程序渲染的流很有用。 请记住，如果您需要使用 `onReady` 手动调用 `startWriting`

## `isServer`

```ts
export const isServer: boolean;
```

这指明了代码是在服务器运行还是在浏览器运行。 由于底层运行时将其导出为常量布尔值，所以它允许构建工具从相应的包中消除代码及其使用的导入代码。

```js
if (isServer) {
  // 永远不会进入浏览器打包代码
} else {
  // 不会在服务器上运行；
```

# 控制流

Solid 使用组件来控制流。原因是为了提高响应式性能，我们必须控制元素的创建方式。 例如，对于列表而言，简单的 `map` 效率低下，因为它总是映射所有内容。 这意味着需要一个辅助函数。

将这些包装在组件中既能很方便地简化模板，也允许用户组合和构建自己的控制流。

这些内置的控制流将被自动导入。除了 `Portal` 和 `Dynamic` 之外的所有内容都是从 `solid-js` 导出的。 这两个 DOM 特定的组件由 `solid-js/web` 导出。

> 注意：控制流的所有回调/渲染函数子项都是非跟踪性的。这允许创建嵌套状态，并更好地隔离响应。

## `<For>`

```ts
export function For<T, U extends JSX.Element>(props: {
  each: readonly T[];
  fallback?: JSX.Element;
  children: (item: T, index: () => number) => U;
}): () => U[];
```

简单的引用键控循环控制流程。

```jsx
<For each={state.list} fallback={<div>Loading...</div>}>
  {item => <div>{item}</div>}
</For>
```

第二个可选参数是索引 signal：

```jsx
<For each={state.list} fallback={<div>Loading...</div>}>
  {(item, index) => (
    <div>
      #{index()} {item}
    </div>
  )}
</For>
```

## `<Show>`

```ts
function Show<T>(props: {
  when: T | undefined | null | false;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: T) => JSX.Element);
}): () => JSX.Element;
```

Show 控制流用于有条件地渲染视图的一部分。 它跟三元运算符（`a ? b : c`）类似，但非常适合模板 JSX。

```jsx
<Show when={state.count > 0} fallback={<div>Loading...</div>}>
  <div>My Content</div>
</Show>
```

Show 还可以用来将区块控到特定数据模型。每当用户数据模型被替换时，该函数就会重新执行。

```jsx
<Show when={state.user} fallback={<div>Loading...</div>}>
  {user => <div>{user.firstName}</div>}
</Show>
```

## `<Switch>`/`<Match>`

```ts
export function Switch(props: { fallback?: JSX.Element; children: JSX.Element }): () => JSX.Element;

type MatchProps<T> = {
  when: T | undefined | null | false;
  children: JSX.Element | ((item: T) => JSX.Element);
};
export function Match<T>(props: MatchProps<T>);
```

当有 2 个以上的互斥条件时会很有用。可以用来做一些简单的路由之类的事情。

```jsx
<Switch fallback={<div>Not Found</div>}>
  <Match when={state.route === "home"}>
    <Home />
  </Match>
  <Match when={state.route === "settings"}>
    <Settings />
  </Match>
</Switch>
```

Match 还支持函数子项作为键映射流程。

## `<Index>`

```ts
export function Index<T, U extends JSX.Element>(props: {
  each: readonly T[];
  fallback?: JSX.Element;
  children: (item: () => T, index: number) => U;
}): () => U[];
```

`<Index>` 在无 key 列表迭代时（或者说 index 作为 key）时很有用，比如数据是 primitive 并且是固定的索引而不是值。

该项是一个 signal：

```jsx
<Index each={state.list} fallback={<div>Loading...</div>}>
  {item => <div>{item()}</div>}
</Index>
```

第二个可选参数是索引号：

```jsx
<Index each={state.list} fallback={<div>Loading...</div>}>
  {(item, index) => (
    <div>
      #{index} {item()}
    </div>
  )}
</Index>
```

## `<ErrorBoundary>`

```ts
function ErrorBoundary(props: {
  fallback: JSX.Element | ((err: any, reset: () => void) => JSX.Element);
  children: JSX.Element;
}): () => JSX.Element;
```

捕获未捕获的错误并渲染回退内容。

```jsx
<ErrorBoundary fallback={<div>Something went terribly wrong</div>}>
  <MyComp />
</ErrorBoundary>
```

还支持回调函数的形式传参，函数传入了错误和重置函数。

```jsx
<ErrorBoundary fallback={(err, reset) => <div onClick={reset}>Error: {err}</div>}>
  <MyComp />
</ErrorBoundary>
```

## `<Suspense>`

```ts
export function Suspense(props: { fallback?: JSX.Element; children: JSX.Element }): JSX.Element;
```

`<Suspense>` 是一个跟踪其下所有读取资源并显示回退占位符状态的组件，直到它们被解析。`Suspense` 与 `Show` 的不同之处在于它是非阻塞的，即使当前不在 DOM 中，两个分支也可以同时存在。

```jsx
<Suspense fallback={<div>Loading...</div>}>
  <AsyncComponent />
</Suspense>
```

## `<SuspenseList>` (实验)

```ts
function SuspenseList(props: {
  children: JSX.Element;
  revealOrder: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}): JSX.Element;
```

`SuspenseList` 可以协调多个并行的 `Suspense` 和 `SuspenseList` 组件。 它控制显示内容的顺序以减少布局抖动，并且可以通过选项控制折叠或隐藏回退状态。

```jsx
<SuspenseList revealOrder="forwards" tail="collapsed">
  <ProfileDetails user={resource.user} />
  <Suspense fallback={<h2>Loading posts...</h2>}>
    <ProfileTimeline posts={resource.posts} />
  </Suspense>
  <Suspense fallback={<h2>Loading fun facts...</h2>}>
    <ProfileTrivia trivia={resource.trivia} />
  </Suspense>
</SuspenseList>
```

SuspenseList 仍处于试验阶段，并没有完整的 SSR 支持。

## `<Dynamic>`

```ts
function Dynamic<T>(
  props: T & {
    children?: any;
    component?: Component<T> | string | keyof JSX.IntrinsicElements;
  }
): () => JSX.Element;
```

该组件允许您插入任意组件或标签并将 props 传递给它。

```jsx
<Dynamic component={state.component} someProp={state.something} />
```

## `<Portal>`

```ts
export function Portal(props: {
  mount?: Node;
  useShadow?: boolean;
  isSVG?: boolean;
  children: JSX.Element;
}): Text;
```

`<Portal>` 会在挂载节点中插入元素。 用于在页面布局之外插入模态框。事件仍然通过组件层次结构传播。

除非目标是 document head，否则 portal 挂载在`<div>` 中。 `useShadow` 将元素放在 Shadow Root 中以进行样式隔离，如果插入到 SVG 元素中，则需要 `isSVG` 避免不插入 `<div>`。

```jsx
<Portal mount={document.getElementById("modal")}>
  <div>My Content</div>
</Portal>
```

# 特殊的 JSX 属性

一般来说，Solid 试图和 DOM 习惯保持一致。 大多数 props 被视为原生元素的属性和 Web Components 的属性，但其中一些具有特殊的行为。

使用 TypeScript 自定义命名空间属性时，您需要扩展 Solid 的 JSX 命名空间：

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

## `ref`

Refs 是一种访问 JSX 中底层 DOM 元素的方式。虽然确实可以将一个元素分配给一个变量，但将组件留在 JSX 流中更为理想。 Refs 在渲染时（在元素连接到 DOM 之前）分配。 它有 2 种写法。

```js
// 简单赋值
let myDiv;

// 连接到 DOM 后使用 onMount 或 createEffect 进行读取
onMount(() => console.log(myDiv));
<div ref={myDiv} />

// 或者，使用回调函数（在元素连接到 DOM 之前调用）
<div ref={el => console.log(el)} />
```

Refs 也可以用于组件。 它们仍然需要连接到另一侧。

```jsx
function MyComp(props) {
  return <div ref={props.ref} />;
}

function App() {
  let myDiv;
  onMount(() => console.log(myDiv.clientWidth));
  return <MyComp ref={myDiv} />;
}
```

## `classList`

`classList` 借助于 `element.classList.toggle`。它接受一个键为 class 名的对象，并在解析值为 true 时分配它们。

```jsx
<div classList={{ active: state.active, editing: state.currentId === row.id }} />
```

## `style`

Solid 的样式工具可以处理字符串或对象。 与 React 的版本不同，Solid 在底层使用了 `element.style.setProperty`。这意味着支持 CSS 变量，但也意味着我们使用较底层的、破折号版本的属性。这实际上会带来更好的性能并能 SSR 输出保持一致。

```jsx
// 字符串
<div style={`color: green; background-color: ${state.color}; height: ${state.height}px`} />

// 变量
<div style={{
  color: "green",
  "background-color": state.color,
  height: state.height + "px" }}
/>

// css 变量
<div style={{ "--my-custom-color": state.themeColor }} />
```

## `innerHTML`/`textContent`


它们的工作原理与它们的等效属性相同。设置一个字符串，它们将被设置到 HTML 中。 **小心!!** 任何数据设置为 `innerHTML` 都可能暴露给终端用户，因此它可能成为恶意攻击的载体。`textContent` 虽然通常不需要，但实际上是一种性能优化，因为它绕过了通用对比差异例程，因此子项将只是文本。

```jsx
<div textContent={state.text} />
```

## `on___`

Solid 中的事件处理程序通常采用 `onclick` 或 `onClick` 形式，具体取决于风格。事件名称总是小写。Solid 对组合和冒泡的常见 UI 事件使用半合成事件委托。这样提高了这些常见事件的性能。

```jsx
<div onClick={e => console.log(e.currentTarget)} />
```

Solid 还支持将数组传递给事件处理句柄以将值绑定到事件处理句柄的第一个参数。 这不用使用`bind` 或创建额外的闭包，因此它是一种高度优化的事件委托方式。

```jsx
function handler(itemId, e) {
  /*...*/
}

<ul>
  <For each={state.list}>{item => <li onClick={[handler, item.id]} />}</For>
</ul>;
```

事件不能被重新绑定并且绑定不是响应式。原因是添加/移除侦听器通常更消耗性能。由于事件自然地会被调用，因此不需要响应性，如果需要，只需跟下面一样简单处理您的事件句柄。

```jsx
// 如果定义了就会调用，否则不会。
<div onClick={() => props.handleClick?.()} />
```

## `on:___`/`oncapture:___`

对其他的事件，可能是名称不寻常或者你不希望被委托，且有 `on` 命名空间。那你只需要逐字添加事件侦听器。

```jsx
<div on:Weird-Event={e => alert(e.detail)} />
```

## `use:___`

`use:___` 是自定义指令。 从某种意义上说，这只是 ref 上的语法糖，但允许我们轻松地将多个指令附加到单个元素。 指令只是一个具有以下签名的函数：

```ts
function directive(element: Element, accessor: () => any): void;
```

这些函数在渲染时运行，您可以在其中执行任何操作。创建 signal 和 effects，注册清理函数，随心所欲。

```js
const [name, setName] = createSignal("");

function model(el, value) {
  const [field, setField] = value();
  createRenderEffect(() => (el.value = field()));
  el.addEventListener("input", e => setField(e.target.value));
}

<input type="text" use:model={[name, setName]} />;
```

注册 TypeScript 扩展 JSX 命名空间。

```ts
declare module "solid-js" {
  namespace JSX {
    interface Directives {
      model: [() => any, (v: any) => any];
    }
  }
}
```

## `prop:___`

强制将 prop 视为 property 而不是 attribute。

```jsx
<div prop:scrollTop={props.scrollPos + "px"} />
```

## `attr:___`

强制将 prop 视为 attribute 而不是 property。 对于要设置 attribute 的 Web 组件很有用。

```jsx
<my-element attr:status={props.status} />
```

## `/* @once */`

Solid 的编译器使用简单的启发式方法对 JSX 表达式进行响应式包装和惰性求值。判断它是否包含函数调用、属性访问或 JSX？ 如果是，我们在传递给组件时将其包装在 getter 中，或者如果传递给原生元素，则将其包装在 effect 中。

知道了这一点，我们可以通过在 JSX 之外访问它们来减少我们知道永远不会改变的东西的开销。一个简单的变量永远不会被包装。我们还可以通过以注释修饰符 `/_ @once _/` 开头的表达式来告诉编译器不要包装它们。

```jsx
<MyComponent static={/*@once*/ state.wontUpdate} />
```

对 children 同样有效。

```jsx
<MyComponent>{/*@once*/ state.wontUpdate}</MyComponent>
```
