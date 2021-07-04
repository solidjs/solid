# 响应性

Solid 的数据管理建立在一系列灵活的响应式 primitives 之上，这些 primitives 负责所有的更新。它采用与 MobX 或 Vue 非常相似的方法，只是它没有和虚拟 DOM 进行颗粒度绑定。当你访问您的 Effects 和 JSX 视图代码中的响应式值时，它会自动跟踪依赖项。

Solid 的 primitives 通常以 `create` 调用的形式出现，通常返回元组，其中通常第一个元素是可读 primitive，第二个元素是 setter。通常通过 primitive 名称来引用可读部分。

这是一个基础的自动递增计数器，它根据设置的 `count` Signal 进行更新

```jsx
import { createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";

const App = () => {
  const [count, setCount] = createSignal(0),
    timer = setInterval(() => setCount(count() + 1), 1000);
  onCleanup(() => clearInterval(timer));

  return <div>{count()}</div>;
};

render(() => <App />, document.getElementById("app"));
```

## Primitives 简介

Solid 由 3 个主要 Primitive 组成，即 Signal、Memo 和 Effect。它们的核心是观察者模式，其中通过封装 Memos 和 Effect 来跟踪 Signal（以及 Memo）。

Signal 是最简单的 primitive。它们包含值，以及 get 和 set 函数，因此我们可以在读取和写入的时候进行拦截

```js
const [count, setCount] = createSignal(0);
```

Effect 是读取 Signal 的封装函数，并且会在依赖的 Signal 值发生变化时重新执行。这对于创建诸如渲染之类副作用很有用。

```js
createEffect(() => console.log("The latest count is", count()));
```

最后，Memo 是缓存的派生值。它们有着 Signal 和 Effect 相同的属性。Memo 跟踪自己的 Signal，仅在这些 Signal 发生变化时重新执行，并且本身是可跟踪的 Signal。

```js
const fullName = createMemo(() => `${firstName()} ${lastName()}`);
```

## 如何运作的？

Signal 作为事件发射器持有订阅列表。每当它们的值发生变化时，它们都会通知其订阅者。

更有趣的是这些订阅是如何发生的。 Solid 使用自动依赖跟踪。数据一旦变化，更新会自动发生。

里面利用了运行时的全局堆栈的小技巧来实现。在 Effect 或 Memo 执行（或重新执行）开发人员编写函数之前，它会将自己压入该堆栈。然后读取的任何 Signal 检查堆栈上是否有当前侦听器，如果有，则将该侦听器添加到其订阅中。

你可以通过下面代码进行思考：

```js
function createSignal(value) {
  const subscribers = new Set();

  const read = () => {
    const listener = getCurrentListener();
    if (listener) subscribers.add(listener);
    return value;
  };

  const write = nextValue => {
    value = nextValue;
    for (const sub of subscribers) sub.run();
  };

  return [read, write];
}
```

现在，每当我们更新信号时，我们就知道要重新运行哪些 Effect。简单而有效。实际的实现要复杂得多，但这就是内部实现的思路。

想要更详细地了解响应性的工作原理，下面有些有用的文章：

[A Hands-on Introduction to Fine-Grained Reactivity](https://dev.to/ryansolid/a-hands-on-introduction-to-fine-grained-reactivity-3ndf)

[Building a Reactive Library from Scratch](https://dev.to/ryansolid/building-a-reactive-library-from-scratch-1i0p)

[SolidJS: Reactivity to Rendering](https://indepth.dev/posts/1289/solidjs-reactivity-to-rendering)

## 注意事项

这种响应式的方法非常强大且灵活。它可以处理不同条件分支下动态执行代码的依赖变更。它还可以在不同的间接层级起作用。在跟踪作用域内执行的任意函数都会被跟踪。

但是，我们必须注意一些关键特征和权衡。

1. 所有响应性都从函数调用中跟踪的，无论是直接的还是隐藏在 getter/proxy 下通过访问属性触发的。这意味着你在何处访问响应式对象的属性很重要。

2. 流程控制下的组件和回调函数不会跟踪作用域且只执行一次。这意味着在组件中解构或在顶层处理逻辑将不会触发重新执行。您必须从其他响应式 primitives 或 JSX 中访问这些 Signal、Store 和属性，以便重新运行对应部分代码。

3. 这种方法只能进行同步跟踪。如果你使用 setTimeout 或在的 Effect 中使用异步函数，那么 Solid 并不会跟踪异步执行的代码。
