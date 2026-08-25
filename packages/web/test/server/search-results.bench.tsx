// Tier-1 SSR-lane bench. Structurally mirrors Tier-2
// `isomorphic-ui-benchmarks/search-results` solid-next entry: a flat list of
// 50 `<Item>` components, each with multiple dynamic JSX expressions and a
// conditional ternary wrapped in `_$memo()` by the compiler.
//
// Captures the same hot-path shapes as the Tier-2 anchor:
//   - per-component shape: 50 owners + 50 `createSignal` calls
//   - compiler's defensive-closure pattern for dynamic JSX expressions
//     (multiple `_v$N = () => …` per row, walked by `tryResolveString`)
//   - per-component `_$memo()` ternary wrap (one extra owner per item via
//     `createSyncMemo` for the conditional render)
//   - `ssr()` arg-walk on attribute-heavy templates (class + style)
//
// Useful for probing closure-elision / memo-elision changes against a
// fast-feedback loop without round-tripping through the external repo.
// Vitest's reported mean is the full `renderToString` cycle.

/**
 * @jsxImportSource @solidjs/web
 */
import { bench } from "vitest";
import { renderToString } from "@solidjs/web";
import { createSignal, For } from "solid-js";

interface SearchItem {
  id: number;
  title: string;
  image: string;
  price: string;
}

const ITEMS: SearchItem[] = Array.from({ length: 50 }, (_, i) => ({
  id: i,
  title: `Search result ${i} — A long-ish item title that exercises the escape() fast path`,
  image: `https://example.com/img/${i}.jpg`,
  price: `$${(i * 9.99).toFixed(2)}`
}));

function Item(props: { item: SearchItem }) {
  const [purchased] = createSignal(false);
  const { id, title, image, price } = props.item;

  return (
    <div class="search-results-item" style={{ "background-color": purchased() ? "#f1c40f" : "" }}>
      <h2 textContent={title} />

      <div class="lvpic pic img left">
        <div class="lvpicinner full-width picW">
          <a href={"/buy/" + id} class="img imgWr2">
            <img src={image} alt={title} />
          </a>
        </div>
      </div>

      <span class="price" textContent={price} />

      {purchased() ? (
        <div class="purchased">Purchased!</div>
      ) : (
        <button class="buy-now" type="button">
          Buy now!
        </button>
      )}
    </div>
  );
}

function App() {
  return (
    <div class="search-results">
      <div>
        <For each={ITEMS}>{item => <Item item={item} />}</For>
      </div>
    </div>
  );
}

bench("search-results: 50 items (renderToString)", () => {
  renderToString(() => <App />);
});
