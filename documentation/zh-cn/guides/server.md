# SSR

Solid 通过将 JSX 模板编译为无比高效的字符串附加代码来处理服务器渲染。这可以通过传入 `generate: "ssr"` 到 babel 插件或者预设来实现。 对于客户端和服务端而言，你都需要传入 `hydratable: true` 来生成注水兼容代码。

在 node 环境中运行时，`solid-js` 和 `solid-js/web` 运行时被置换为非响应式的对应。 对于其他环境，你需要将导出条件设置为 `node` 来打包服务端代码。 大多数构建工具都有办法做到这一点。 一般来说，我们还是建议使用 `solid` 的导出条件，并建议库在`solid` 的导出条件下输出源代码。

构建 SSR 肯定需要更多配置，因为我们需要生成 2 个单独的包。客户端入口应该使用 `hydrate`：

```jsx
import { hydrate } from "solid-js/web";

hydrate(() => <App />, document);
```

_注意：可以从文档根节点进行渲染和注水。 这允许我们在 JSX 中描述完整的视图。_

服务器入口可以使用 Solid 提供的四个渲染函数之一。 每个都会输出对应产物或者是一个要插入到文档头部的脚本标签。

```jsx
import {
  renderToString,
  renderToStringAsync,
  renderToNodeStream,
  renderToWebStream
} from "solid-js/web";

// 同步字符串渲染
const html = renderToString(() => <App />);

// 异步字符串渲染
const html = await renderToStringAsync(() => <App />);

// Node Stream API
pipeToNodeWritable(App, res);

// Web Stream API (适用于 Cloudflare Workers)
const { readable, writable } = new TransformStream();
pipeToWritable(() => <App />, writable);
```

为方便起见，`solid-js/web` 导出了一个十分有用的 `isServer` 标志。 这样大多数打包工具将能够在此标志下对任意代码进行的 treeshake 操作，或者仅在此标志下使用浏览器端之外的代码。

```jsx
import { isServer } from "solid-js/web";

if (isServer) {
  // 仅在服务端执行此操作
} else {
  // 仅在浏览器上执行此操作
}
```

## 注水脚本

甚至为了在 Solid 运行时加载之前渐进式注水，需要在页面上插入一个特殊的脚本。 这个脚本可以通过 `generateHydrationScript` 生成和插入，也可以使用 `<HydrationScript />` JSX 标签。

```js
import { generateHydrationScript } from "solid-js/web";

const app = renderToString(() => <App />);

const html = `
  <html lang="en">
    <head>
      <title>🔥 Solid SSR 🔥</title>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="stylesheet" href="/styles.css" />
      ${generateHydrationScript()}
    </head>
    <body>${app}</body>
  </html>
`;
```

```jsx
import { HydrationScript } from "solid-js/web";

const App = () => {
  return (
    <html lang="en">
      <head>
        <title>🔥 Solid SSR 🔥</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="/styles.css" />
        <HydrationScript />
      </head>
      <body>{/*... App 其他部分*/}</body>
    </html>
  );
};
```

当从文档中插入客户端不可用的资源来进行注水时，就会把事情搞砸。 Solid 提供了一个 `<NoHydration>` 组件，其子组件可以在服务器上正常工作，但不会在浏览器中注水。

```jsx
<NoHydration>
  {manifest.map(m => (
    <link rel="modulepreload" href={m.href} />
  ))}
</NoHydration>
```

## 异步和流式 SSR

异步和流式服务端渲染机制建立在 Solid 对应用如何工作的了解之上。它通过在服务器上使用 Suspense 和 Resource API 来实现，而不是提前获取然后渲染。Solid 获取资源数据在服务器上行为，就像在客户端上一样。 代码的编写方式和执行模式完全相同。

异步渲染会等到所有 Suspense 边界解析后发送结果（或在静态站点生成的情况下将它们写入文件）。

一旦服务器将流同步地将内容刷新到浏览器，那么浏览器会即时展示你的 Suspense 回退。然后当异步数据在服务器上完成时，它通过相同的流将数据发送到客户端以完成 Suspense，浏览器完成工作并用真实内容替换回退。

这种方法的优点：

- 服务器不必等待异步数据响应。资源可以更快地开始在浏览器中加载，并且用户能够更快地看到内容。
- 与 JAMStack 之类的客户端获取方案相比，这种方案的数据加载在服务器上即时开始，无需等待客户端 JavaScript 进行加载。
- 所有数据都被序列化并自动从服务器传输到客户端。

## SSR 注意事项

Solid 的 SSR 同构解决方案非常强大，因为你可以将代码编写一份代码就差不多可以在在两种环境中运行。然而，有人期望这会增加注水功能。 大多数情况下，客户端中渲染的视图与服务器上渲染的视图大体相同。精确到文本可能不同，但在结构上标记应该是相同的。

我们使用在服务端中渲染的标记来匹配客户端的元素和资源位置。为此，客户端和服务器应该具有相同的组件。鉴于 Solid 在客户端和服务器上以相同的方式渲染，这根本不是问题。但是目前没有办法在服务器上渲染不会在客户端注水的东西。 也没有办法对整个页面进行部分注水，也无法为其生成注水标记。 要么全有要么全无。部分注水是我们未来想要探索的东西。

最后，所有资源都需要在 `render` 树下定义。它们会自动序列化并在浏览器中提取，这样起作用是因为 `render` 或 `pipeTo` 方法会跟踪渲染的进度。 如果它们是在独立的上下文中创建的，我们就无法做到跟踪。同理可得，服务器上没有响应性，因此不要在初始渲染时更新 signal，并期望它们传递到树的上层。虽然我们有 Suspense 边界，但 Solid 的 SSR 基本是自上而下的。

## SSR 入门

SSR 配置很棘手。我们准备了几个示例包 [solid-ssr](https://github.com/solidjs/solid/blob/main/packages/solid-ssr) 。与此同时，一个新的脚手架工具正在开发中 [SolidStart](https://github.com/solidjs/solid-start) 旨在使开发更加流畅。

## 静态站点生成入门

[solid-ssr](https://github.com/solidjs/solid/blob/main/packages/solid-ssr) 还附带一个用于生成静态或预渲染站点实用工具。阅读 README 文件了解更多信息。
