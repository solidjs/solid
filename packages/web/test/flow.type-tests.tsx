/** @jsxImportSource @solidjs/web */

import { createSignal, For, Match, Show, Switch } from "solid-js";

const [count] = createSignal(1);

<Show when={count()}>{value => <div>{value()}</div>}</Show>;
<Show when={count()} keyed>
  {value => <div>{value.toFixed()}</div>}
</Show>;
<Show when={count()}>{count()}</Show>;
// @ts-expect-error zero-arg callback children are ambiguous and should not typecheck in JSX
<Show when={count()}>{() => <div />}</Show>;
// @ts-expect-error bare accessors should be invoked before being passed as JSX children
<Show when={count()}>{count}</Show>;
<Show when={count()} keyed>
  {value => (
    // @ts-expect-error keyed Show passes a raw value, not an accessor
    <div>{value()}</div>
  )}
</Show>;

<Switch fallback={<div>fallback</div>}>
  <Match when={count()}>{value => <div>{value()}</div>}</Match>
  <Match when={count()} keyed>
    {value => <div>{value.toFixed()}</div>}
  </Match>
  <Match when={true}>ok</Match>
</Switch>;

<Match when={count()}>{value => <div>{value()}</div>}</Match>;
<Match when={count()} keyed>
  {value => <div>{value.toFixed()}</div>}
</Match>;
<Match when={count()}>{count()}</Match>;
<Match when={count()} keyed>
  {value => (
    // @ts-expect-error keyed Match passes a raw value, not an accessor
    <div>{value()}</div>
  )}
</Match>;

const rows = [{ id: "a", label: "A" }];
<For each={rows}>{(row, index) => <div data-index={index()}>{row.label}</div>}</For>;
<For each={rows} keyed>
  {(row, index) => <div data-index={index()}>{row.label}</div>}
</For>;
<For each={rows} keyed={false}>
  {(row, index) => <div data-index={index}>{row().label}</div>}
</For>;
<For each={rows} keyed={row => row.id}>
  {(row, index) => <div data-index={index()}>{row().label}</div>}
</For>;
// @ts-expect-error default For passes a raw row, not an accessor
<For each={rows}>{row => <div>{row().label}</div>}</For>;
<For each={rows} keyed={false}>
  {(row, index) => (
    // @ts-expect-error keyed:false passes a raw index, not an accessor
    <div>{index()}</div>
  )}
</For>;
<For each={rows} keyed={row => row.id}>
  {row => (
    // @ts-expect-error key-function For passes an item accessor, not a raw row
    <div>{row.label}</div>
  )}
</For>;
