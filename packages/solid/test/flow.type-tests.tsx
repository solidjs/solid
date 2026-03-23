/** @jsxImportSource solid-js */

import { createSignal, Match, Show, Switch } from "../src/index.js";

const [count] = createSignal(1);

<Show when={count()}>{value => <div>{value()}</div>}</Show>;
<Show when={count()}>{count()}</Show>;
// @ts-expect-error zero-arg callback children are ambiguous and should not typecheck in JSX
<Show when={count()}>{() => <div />}</Show>;
// @ts-expect-error bare accessors should be invoked before being passed as JSX children
<Show when={count()}>{count}</Show>;

<Switch fallback={<div>fallback</div>}>
  <Match when={count()}>{value => <div>{value()}</div>}</Match>
  <Match when={true}>ok</Match>
</Switch>;

<Match when={count()}>{value => <div>{value()}</div>}</Match>;
<Match when={count()}>{count()}</Match>;
// @ts-expect-error zero-arg callback children are ambiguous and should not typecheck in JSX
<Match when={count()}>{() => <div />}</Match>;
// @ts-expect-error bare accessors should be invoked before being passed as JSX children
<Match when={count()}>{count}</Match>;
