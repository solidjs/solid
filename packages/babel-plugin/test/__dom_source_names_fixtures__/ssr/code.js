import { Child, Ui, Row } from "./components";

const Component = () => <Child name="John" />;

const template = (
  <div>
    <Child name="Jane" {...props}>
      <span>{name()}</span>
    </Child>
    <Ui.Button variant="primary" />
    <Ui.Layout.Grid cols={2}>text</Ui.Layout.Grid>
    <For each={list()}>{item => <Row item={item} />}</For>
    <Show when={visible()}>
      <Child />
    </Show>
    <this.Row />
    <Comp>{() => <Child />}</Comp>
  </div>
);

class Container {
  render() {
    return <this.Row />;
  }
}
