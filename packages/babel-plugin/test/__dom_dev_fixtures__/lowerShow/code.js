import { Show, createSignal, createMemo } from "solid-js";
import { Show as Visible } from "@solidjs/web";

const [user, setUser] = createSignal();
const total = createMemo(() => 1);
let mutable = createSignal(0)[0];

// Lowered: JSX children, with and without a fallback.
const Root = () => (
  <Show when={user()} fallback={<p>Sign in</p>}>
    <h1>Welcome</h1>
  </Show>
);
const InElement = props => (
  <div>
    <Show when={props.open}>hi {props.name}</Show>
    <span />
  </div>
);
const InFragment = () => (
  <>
    <Show when={total() > 1}>many</Show>
  </>
);
const SoleComponentChild = () => (
  <Panel>
    <Show when={total()}>
      <b>total</b>
    </Show>
  </Panel>
);
const Renamed = () => <Visible when={user()}>renamed</Visible>;
const Empty = () => <Show when={user()} />;

// Lowered: a callback whose `when` is a plain read; `u()` reads `when`.
const Callback = () => <Show when={user()}>{u => <b title={u().id}>{u().name}</b>}</Show>;
const CallbackMember = props => (
  <Show when={props.user?.profile} fallback={<i>none</i>}>
    {profile => <Card profile={profile} name={profile().name} />}
  </Show>
);
const Nested = props => (
  <Show when={props.a}>
    <Show when={props.b}>{b => <i>{b().c}</i>}</Show>
  </Show>
);

// Kept: keyed, a spread, another prop, a bare or string attribute.
const Keyed = () => (
  <Show when={user()} keyed>
    {u => <b>{u.name}</b>}
  </Show>
);
const Spread = props => <Show {...props}>x</Show>;
const Other = () => (
  <Show when={user()} name="x">
    x
  </Show>
);
const Bare = () => <Show when>x</Show>;
// Kept: a callback with a `when` that is not a plain read, or a block body.
const Fetched = () => <Show when={load()}>{u => <b>{u().name}</b>}</Show>;
const Mutable = () => <Show when={mutable()}>{u => <b>{u()}</b>}</Show>;
const Block = () => (
  <Show when={user()}>
    {u => {
      return <b>{u().name}</b>;
    }}
  </Show>
);
const Shadowed = () => <Show when={user()}>{u => <b>{[1].map(user => u().name + user)}</b>}</Show>;
// Kept: a child that could be a function, a non-sole component child, an
// attribute, or inside a JSX expression.
const Render = props => <Show when={user()}>{props.render}</Show>;
const Siblings = () => (
  <Panel>
    <Show when={user()}>x</Show>
    <i />
  </Panel>
);
const Attribute = () => <Panel fallback={<Show when={user()}>x</Show>} />;
const InExpression = props => <div>{props.ok && <Show when={user()}>x</Show>}</div>;
// Kept: not Solid's `<Show>`.
const Local = () => {
  const Show = props => props.children;
  return <Show when={user()}>x</Show>;
};
