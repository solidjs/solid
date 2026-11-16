import { Show, createSignal, createMemo, createStore } from "solid-js";
import { Show as Visible } from "@solidjs/web";

const [user, setUser] = createSignal();
const total = createMemo(() => 1);
let mutable = createSignal(0)[0];
const [state] = createStore({ user: { profile: { name: "" } } });

// Lowered: JSX children, with and without a fallback.
const Root = () => (
  <Show when={user()} fallback={<label>Sign in</label>}>
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
      <span>total</span>
    </Show>
  </Panel>
);
const Renamed = () => <Visible when={user()}>renamed</Visible>;
const Empty = () => <Show when={user()} />;

// Lowered: a callback whose `when` is a plain read; `u()` reads `when`.
const Callback = () => <Show when={user()}>{u => <span title={u().id}>{u().name}</span>}</Show>;
const CallbackMember = () => (
  <Show when={state.user?.profile} fallback={<label>none</label>}>
    {profile => <Card profile={profile} name={profile().name} />}
  </Show>
);
const Nested = () => (
  <Show when={user()}>
    <Show when={state.user}>{b => <label>{b().profile.name}</label>}</Show>
  </Show>
);

// Kept: keyed, a spread, another prop, a bare or string attribute.
const Keyed = () => (
  <Show when={user()} keyed>
    {u => <span>{u.name}</span>}
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
const Fetched = () => <Show when={load()}>{u => <span>{u().name}</span>}</Show>;
const Mutable = () => <Show when={mutable()}>{u => <span>{u()}</span>}</Show>;
// Kept: a prop's getter can make its JSX again on each read (#4936).
const PropChild = props => <Show when={props.children}>{child => <label>{child()}</label>}</Show>;
const PropMember = props => <Show when={props.user?.profile}>{p => <span>{p().name}</span>}</Show>;
const Block = () => (
  <Show when={user()}>
    {u => {
      return <span>{u().name}</span>;
    }}
  </Show>
);
const Shadowed = () => (
  <Show when={user()}>{u => <span>{[1].map(user => u().name + user)}</span>}</Show>
);
// Kept: a child that could be a function, a non-sole component child, an
// attribute, or inside a JSX expression.
const Render = props => <Show when={user()}>{props.render}</Show>;
const Siblings = () => (
  <Panel>
    <Show when={user()}>x</Show>
    <label />
  </Panel>
);
const Attribute = () => <Panel fallback={<Show when={user()}>x</Show>} />;
const InExpression = props => <div>{props.ok && <Show when={user()}>x</Show>}</div>;
// Kept: not Solid's `<Show>`.
const Local = () => {
  const Show = props => props.children;
  return <Show when={user()}>x</Show>;
};
