# 渲染

Solid 支持 JSX、标签模板字面量 和 Solid HyperScript 变体这 3 种模板形式。其中 JSX 是主流，这是因为 JSX 是一门优秀的编译型 DSL。它有着清晰的语法，支持 TypeScript，可与 Babel 配合使用，并支持其他工具，如代码语法高亮和 Prettier。使用一种基本上免费为你提供所有功能的工具是相当务实的。JSX 作为一个编译的解决方案，它提供了很好的开发体验。当你可以使用一门如此广受支持且支持自定义语法的 DSL 时，有什么可纠结的呢？

## JSX 编译

渲染涉及到将 JSX 模板预编译为优化的原生 js 代码。JSX 代码会被构造成：

- 在每个实例都会被克隆的模板 DOM 元素
- 仅使用 firstChild 和 nextSibling 的一系列引用声明
- 更新已创建元素的细粒度计算

与使用 document.createElement 一个一个地创建每个元素相比，这种方法的性能更高，生成的代码更少。

## Attributes 和 Props

Solid 尝试尽可能地与 HTML 的 attribute 保持一致，包括不区分属性的大小写。

原生元素 JSX 上的大多数 attribute 都被设置为 DOM attribute。静态值会直接内置到克隆模板中。也有例外，诸如 `class`、`style`、`value`、`innerHTML`之类会提供了额外的功能。

但是，自定义元素（内置的原生元素除外）在动态时默视为认为 property。这是为了处理更复杂的数据类型。为了遵循习惯，Solid 直接将蛇形命名（`some-attr`）转化为驼峰命名（`someAttr`）。

但是，也可以使用命名空间指令直接控制该行为。你可以使用 `attr:` 指定 attribute 或者使用 `prop:` 指定 property

```jsx
<my-element prop:UniqACC={state.value} attr:title={state.title} />
```

> **注意：** 静态 attribute 是作为 html 克隆模板的一部分被创建的。固定和动态表达式随后按 JSX 绑定顺序应用。虽然这对大多数 DOM 元素来说都无所谓顺序，但是对诸如带有 `type='range'` 的 input 元素来说，顺序很重要。绑定元素时请牢记这一点。

## 入口

挂载 Solid 应用最简单方法是从 `solid-js/web` 导入 `render`。`render` 接收一个函数作为第一个参数，接收挂载容器作为第二个参数，并返回一个销毁方法。这个 `render` 函数会自动创建响应式根节点根并在挂载容器中处理渲染工作。为了获得最佳性能，建议使用没有子元素的元素。

```jsx
import { render } from "solid-js/web";

render(() => <App />, document.getElementById("main"));
```

> **重要** 第一个参数必须是一个函数。否则 Solid 无法正确跟踪和调度响应系统。偷懒将导致你的 Effect 无法运行。

## 组件

Solid 组件通常是采用 Pascal（大写）命名风格的函数。组件第一个参数接收 props 对象，最终返回真实的 DOM 节点。

```jsx
const Parent = () => (
  <section>
    <Label greeting="Hello">
      <div>John</div>
    </Label>
  </section>
);

const Label = props => (
  <>
    <div>{props.greeting}</div>
    {props.children}
  </>
);
```

由于所有 JSX 节点都是真实的 DOM 节点，顶级组件的唯一职责是将这些 DOM 节点追加到容器 DOM。

## Props

与 React、Vue、Angular 以及其他框架非常相似，Solid 允许你在组件上定义 property，将数据传递给子组件。这里的父组件通过 `greeting` property 将字符串 “Hello” 传递给 `Label` 组件。

```jsx
const Parent = () => (
  <section>
    <Label greeting="Hello">
      <div>John</div>
    </Label>
  </section>
);
```

在上面的例子中，在 `greeting` 上设置的值是静态的，但我们也可以设置动态值。例如：

```jsx
const Parent = () => {
  const [greeting, setGreeting] = createSignal("Hello");

  return (
    <section>
      <Label greeting={greeting()}>
        <div>John</div>
      </Label>
    </section>
  );
};
```

组件可以通过 `props` 参数访问传递给它们的属性。

```jsx
const Label = props => (
  <>
    <div>{props.greeting}</div>
    {props.children}
  </>
);
```

与其他框架不同，你不能在组件的 `props` 上使用对象解构。这是因为 `props` 对象在底层依赖对象的 getter 来惰性获取值。使用对象解构破坏了 props 的响应性。

这个例子展示了在 Solid 中访问 props 的正确方式：

```jsx
// 这里 `props.name` 会按照你的期望更新
const MyComponent = props => <div>{props.name}</div>;
```

这个例子展示了在 Solid 中访问 props 的错误方式：

```jsx
// 错误方式
// 这里，`props.name` 不会更新（即不是响应式的），因为它被解构为 `name`
const MyComponent = ({ name }) => <div>{name}</div>;
```

虽然 props 对象在使用时看起来像一个普通对象（Typescript 用户会注意到它的类型像普通对象），但实际上它是响应式的 —— 有点类似于 Signal。这有几个含义。

因为与大多数 JSX 框架不同，Solid 的函数组件只执行一次（而不是每个渲染周期都执行），所以下面的示例不会按预期工作。

```jsx
import { createSignal } from "solid-js";

const BasicComponent = props => {
  const value = props.value || "default";

  return <div>{value}</div>;
};

export default function Form() {
  const [value, setValue] = createSignal("");

  return (
    <div>
      <BasicComponent value={value()} />
      <input type="text" oninput={e => setValue(e.currentTarget.value)} />
    </div>
  );
}
```

在这个例子中，我们期望的是 `BasicComponent` 显示输入到 `input` 中的当前值。但是，提醒一下，`BasicComponent` 函数只会在组件最初创建时执行一次。此时（在创建时），`props.value` 将等于 `''`。这意味着 `BasicComponent` 中的 `const value` 将解析为 `'default'` 并且永远不会更新。虽然 `props` 对象是响应式的，访问 `const value = props.value || 'default';` 中的 props 就超出了 Solid 的可观察范围，因此当 props 更改时组件不会自动重新求值。

那么我们该如何解决我们的问题呢？

嗯，一般来说，我们需要在 Solid 可以观察到的地方访问 `props`。通常，这意味着在 JSX 内或在 `createMemo`、`createEffect` 或 thunk(`() => ...`) 内。这里有一种按照你的预期工作的解决方案：

```jsx
const BasicComponent = props => {
  return <div>{props.value || "default"}</div>;
};
```

这也可以等效地提升为一个函数：

```jsx
const BasicComponent = props => {
  const value = () => props.value || "default";

  return <div>{value()}</div>;
};
```

另一种方案，如果这是一个耗时计算的场景，那应该使用 `createMemo`。例如：

```jsx
const BasicComponent = props => {
  const value = createMemo(() => props.value || "default");

  return <div>{value()}</div>;
};
```

或者使用工具函数

```jsx
const BasicComponent = props => {
  props = mergeProps({ value: "default" }, props);

  return <div>{props.value}</div>;
};
```

提醒一下，以下示例将 _不会_ 工作：

```jsx
// 错误示例
const BasicComponent = props => {
  const { value: valueProp } = props;
  const value = createMemo(() => valueProp || "default");
  return <div>{value()}</div>;
};

// 错误示例
const BasicComponent = props => {
  const valueProp = prop.value;
  const value = createMemo(() => valueProp || "default");
  return <div>{value()}</div>;
};
```

Solid 的组件是其性能的核心部分。Solid 所谓的 “消失” 组件是通过 prop 惰性求值实现的。而不是对 prop 表达式进行即时求值并传递，它推迟到了 child 中访问 prop 再执行。这样的话我们将执行推迟到最后一刻 —— 通常在 DOM 绑定，从而最大限度地提高性能。这么做不仅使层次结构扁平化而且消除了维护组件树的需要。

```jsx
<Component prop1="static" prop2={state.dynamic} />;

// 大致编译为：
// 我们取消跟踪组件主体来隔离它并避免更新消耗
untrack(() =>
  Component({
    prop1: "static",
    // 动态表达式，所以我们将其包裹在一个 getter 中
    get prop2() {
      return state.dynamic;
    }
  })
);
```

为了帮助保持响应性，Solid 有几个工具函数：

```jsx
// 默认 props
props = mergeProps({ name: "Smith" }, props);

// 克隆 props
const newProps = mergeProps(props);

// 合并 props
props = mergeProps(props, otherProps);

// 将 props 拆分为多个 props 对象
const [local, others] = splitProps(props, ["className"])
<div {...others} className={cx(local.className, theme.component)} />
```

## Children

Solid 处理 JSX Children 的方式类似 React。单个 child 是 `props.children` 上的单个值，多个 child 是通过值成员数组处理的。通常，你将 child 传递给 JSX 视图。但是，如果你想与它们交互，建议使用 `children` 工具函数，它能够解析任何下游流程控制并返回 Memo。

```jsx
// 单个子节点
const Label = (props) => <div class="label">Hi, { props.children }</div>

<Label><span>Josie</span></Label>

// 多个子节点
const List = (props) => <div>{props.children}</div>;

<List>
  <div>First</div>
  {state.expression}
  <Label>Judith</Label>
</List>

// 映射子节点
const List = (props) => <ul>
  <For each={props.children}>{item => <li>{item}</li>}</For>
</ul>;

// 使用工具函数修改和映射子项
const List = (props) => {
  // children 工具函数缓存值并处理所有中间反应性
  const memo = children(() => props.children);
  createEffect(() => {
    const children = memo();
    children.forEach((c) => c.classList.add("list-child"))
  })
  return <ul>
    <For each={memo()}>{item => <li>{item}</li>}</For>
  </ul>;
```

**重要：** Solid 将 child 标签视为耗性能的表达式，并用与动态响应式表达式相同的方式包装它们。这意味着他们利用访问 `prop` 进行了惰性求值。在视图中使用它们之前，请小心避免多次访问它们或者进行解构。这是因为 Solid 没有大费周章地提前创建虚拟 DOM 节点然后对它们进行 diff 操作，所以这些 `props` 的解析必须是惰性且经过斟酌的。如果你希望这样做，请使用 `children` 工具函数，因为 `children` 会缓存这些值。
