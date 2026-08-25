// Tier-1 SSR-lane bench. Structurally mirrors Tier-2
// `isomorphic-ui-benchmarks/color-picker` solid-next entry: a small nested
// tree with a per-row component rendered under `<For>`, plus a single
// conditional class expression and an outer `selectedColor` text accessor.
//
// Captures (the same hot-path shapes as the Tier-2 anchor):
//   - mapArray row-owner pool churn under <For>
//   - per-row deferred-closure walk in `tryResolveString`
//   - `ssr()` arg-walk for attribute-heavy templates (class + style)
//   - per-row `_$memo()` ternary wrap on conditional class
//   - top-level signal-derived text expression
//
// Vitest's reported mean is the full `renderToString` cycle.
//
// Tier 2 is the source of truth for absolute numbers; this bench only
// measures *delta* between baseline and probe on the same machine, which
// is enough to gate the AI loop without bouncing to the external repo.

/**
 * @jsxImportSource @solidjs/web
 */
import { bench } from "vitest";
import { renderToString } from "@solidjs/web";
import { createSignal, For } from "solid-js";

interface Color {
  name: string;
  hex: string;
}

const COLORS: Color[] = [
  { name: "aliceblue", hex: "#F0F8FF" },
  { name: "antiquewhite", hex: "#FAEBD7" },
  { name: "aqua", hex: "#00FFFF" },
  { name: "aquamarine", hex: "#7FFFD4" },
  { name: "azure", hex: "#F0FFFF" },
  { name: "beige", hex: "#F5F5DC" },
  { name: "bisque", hex: "#FFE4C4" },
  { name: "black", hex: "#000000" },
  { name: "blanchedalmond", hex: "#FFEBCD" },
  { name: "blue", hex: "#0000FF" },
  { name: "blueviolet", hex: "#8A2BE2" },
  { name: "brown", hex: "#A52A2A" },
  { name: "burlywood", hex: "#DEB887" },
  { name: "cadetblue", hex: "#5F9EA0" }
];

function App() {
  const [selectedColorIndex] = createSignal(0);
  const selectedColor = () => COLORS[selectedColorIndex()];
  return (
    <div class="colors">
      <h1>Choose your favorite color:</h1>
      <div class="colors">
        {COLORS.length ? (
          <ul>
            <For each={COLORS}>
              {({ name, hex }, i) => (
                <li
                  class={"color" + (selectedColorIndex() === i() ? " selected" : "")}
                  style={{ "background-color": hex }}
                  textContent={name}
                />
              )}
            </For>
          </ul>
        ) : (
          <div>No colors!</div>
        )}
      </div>
      <div>
        You chose:
        <div class="chosen-color">{selectedColor().name}</div>
      </div>
    </div>
  );
}

bench("color-picker: 14 colors (renderToString)", () => {
  renderToString(() => <App />);
});
