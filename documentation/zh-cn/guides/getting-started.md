# 让我们开始吧

## 使用 Solid

到目前为止，开始使用 Solid 的最简单方法是在线使用。在我们的 REPL(https://playground.solidjs.com) 上尝试各种想法是一种不错方式。另外你也可以在 https://codesandbox.io/ 修改我们的示例代码。

你也可以通过在终端中运行以下命令来创建并启动简单的 Vite 模板项目：

```sh
> npx degit solidjs/templates/js my-app
> cd my-app
> npm i # or yarn or pnpm
> npm run dev # or yarn or pnpm
```

使用 TypeScript ：

```sh
> npx degit solidjs/templates/ts my-app
> cd my-app
> npm i # or yarn or pnpm
> npm run dev # or yarn or pnpm
```

## 学习 Solid

Solid 到处都是可组合的小片段，用这些片段用来构建应用块。这些部分主要由许多浅显的顶级 API 的函数组成。幸运的是，你无需了解其中的大部分内容即可开始使用。

你可以使用组件和响应式 Primitives 这两种主流方式来构建区块

组件是接受 props 对象并返回 JSX 元素（包括原生 DOM 元素和其他组件）的函数。它们可以用大驼峰拼写表示为 JSX 元素

```jsx
function MyComponent(props) {
  return <div>Hello {props.name}</div>;
}

<MyComponent name="Solid" />;
```

组件是轻量级的，因为它们本身没有状态，也没有实例。相反，它们充当 DOM 元素和响应式 primitives 的工厂函数

Solid 的细粒度响应式建立在 3 个简单的 primitives 之上：Signals、Memos 和 Effects。它们共同构成了一个自动跟踪同步引擎，可确保你的视图保持最新。响应式计算采用了简单包装函数表达式的形式，另外他们是同步执行的

```js
const [first, setFirst] = createSignal("JSON");
const [last, setLast] = createSignal("Bourne");

createEffect(() => console.log(`${first()} ${last()}`));
```

你可以在以下内容中了解更多 [Solid's Reactivity](https://www.solidjs.com/docs/latest#reactivity) 和 [Solid's Rendering](https://www.solidjs.com/docs/latest#rendering).

## Solid 理念

Solid 的设计提出了一些可以帮助我们最好地构建网站和应用程序的原则和价值观。当你了解 Solid 背后的哲学时，学习和使用 Solid 会更容易。

### 1. 声明式数据

声明式数据是将数据行为的描述与其声明联系起来的实践。这允许我们通过将数据行为的所有方面打包在一个地方来轻松组合。

### 2. 消失的组件

在不考虑更新的情况下构建组件已经够难的了。Solid 的组件更新是彼此完全独立的。组件函数被调用一次，然后就不再存在。组件的存在是为了组织你的代码，而不是其他。

### 3. 读/写 分离

精确的控制和可预测性有助于打造更好的系统。我们不需要真正的不变性来强制执行单向数据流，只需要能够有意识到哪些消费者可能会写，哪些可能不会。

### 4. 简单胜于容易

细粒度响应性教会我们：明确且一致的约定即使需要更多努力也是值得的。且有必要提供最少的工具作为构建的基础。

## Web 组件

Solid 生而将 Web 组件作为一等公民。随着时间的推移，它的设计不断发展，目标也发生了变化。然而，Solid 仍然是编写 Web 组件的好选择。[Solid Element](https://github.com/solidjs/solid/tree/main/packages/solid-element) 允许你编写和包装 Solid 的函数组件以生成小型且高性能的 Web 组件。在 Solid 应用程序中，Solid Element 仍然能够利用 Solid 的 Context API，并且 Solid 的 Portals 支持隔离样式的 Shadow DOM 。

## 服务端渲染

Solid 拥有动态的服务器端渲染解决方案，可实现真正的同构开发体验。通过使用我们的 Resource primitive，很容易进行异步数据请求，更重要的是，我们也可以在客户端和浏览器之间自动序列化和同步。

由于 Solid 支持服务器上的异步和流式渲染，因此你可以以一种方式编写代码并让它在服务器上执行。这个特性类似 [render-as-you-fetch](https://reactjs.org/docs/concurrent-mode-suspense.html#approach-3-render-as-you-fetch-using-suspense)，并且代码分割特性也适用于 Solid。

更多信息，请阅读 [服务端渲染指南](https://www.solidjs.com/docs/latest#server-side-rendering).

## 无编译?

不喜欢 JSX？不介意手动包装表达式、性能更差和包大小更大吗？你可以采用另一种方案：在非编译环境中使用标记模板字面量或 HyperScript 创建 Solid 应用。

你可以直接在浏览器中运行下面代码 [Skypack](https://www.skypack.dev/):

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

请记住，你仍然需要相应的 DOM 表达式库才能配合 TypeScript 使用。你也可以搭配 [Lit DOM Expressions](https://github.com/ryansolid/dom-expressions/tree/main/packages/lit-dom-expressions) 使用标签模板字面量或者搭配 [Hyper DOM Expressions](https://github.com/ryansolid/dom-expressions/tree/main/packages/hyper-dom-expressions) 使用 HyperScript。
