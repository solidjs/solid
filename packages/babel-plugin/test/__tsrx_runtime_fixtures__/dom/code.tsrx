import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";

const [rows, setRows] = createSignal([
  { id: 1, label: "one" },
  { id: 2, label: "two" }
]);
let &[count, setCount] = createSignal(0);
const model = { version: 0 };
let &{ version } = model;

export function App() @{
  <section>
    <button onClick={() => setCount(count() + 1)}>Count: {count}</button>
    <ul>
      @for (const row of rows(); key row.id) {
        <li data-id={row.id}>{row.label}</li>
      } @empty {
        <li class="empty">empty</li>
      }
    </ul>
    @if (count() > 0) {
      <p class="status">active</p>
    } @else {
      <p class="status">idle</p>
    }
  </section>
}

export function mount(target) {
  return render(App, target);
}

export function replaceRows(next) {
  setRows(next);
  flush();
}

export function settle() {
  flush();
}

export function bumpVersion() {
  return ++version;
}

export function modelVersion() {
  return version;
}
