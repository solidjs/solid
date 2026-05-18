import { createSignal, Show } from "solid-js";
import { render } from "@solidjs/web";
import { Canvas } from "./Canvas";

type Slot = "hero" | "pip" | "dock";

const SLOT_LABELS: Record<Slot, string> = {
  hero: "Hero",
  pip: "PIP (corner)",
  dock: "Dock"
};

function slotClass(s: Slot): string {
  return `slot-${s}`;
}

function App() {
  const [slot, setSlot] = createSignal<Slot>("hero");

  // Left panel — the `<Canvas />` JSX is evaluated once and stored in a
  // variable. Every `<Show>` slot references the same value, so the runtime
  // migrates a single DOM node between slots.
  const hoistedCanvas = <Canvas />;

  return (
    <main class="app">
      <header>
        <h1>Migrating element</h1>
        <p class="lede">
          Same <code>&lt;Canvas /&gt;</code> component on both panels — hoisted to a variable on the
          left, written inline inside each slot on the right. Pick a slot and watch what happens to
          the painted logo and the splats.
        </p>

        <div class="controls">
          <span class="label">Active slot:</span>
          {(["hero", "pip", "dock"] as Slot[]).map(s => (
            <button class={{ active: slot() === s }} onClick={() => setSlot(s)}>
              {SLOT_LABELS[s]}
            </button>
          ))}
          <span class="hint">click either canvas to add a splat</span>
        </div>
      </header>

      <section class="split">
        <article class="panel panel-good">
          <h2>✓ Hoisted — one JSX expression, three slots</h2>
          <pre class="code">{`const hoistedCanvas = <Canvas />;

<Show when={slot() === "hero"}>{hoistedCanvas}</Show>
<Show when={slot() === "pip"}>{hoistedCanvas}</Show>
<Show when={slot() === "dock"}>{hoistedCanvas}</Show>`}</pre>
          <div class="stage">
            <Show when={slot() === "hero"}>
              <div class={slotClass("hero")}>{hoistedCanvas}</div>
            </Show>
            <Show when={slot() === "pip"}>
              <div class={slotClass("pip")}>{hoistedCanvas}</div>
            </Show>
            <Show when={slot() === "dock"}>
              <div class={slotClass("dock")}>{hoistedCanvas}</div>
            </Show>
          </div>
        </article>

        <article class="panel panel-bad">
          <h2>✗ Inline — fresh JSX per slot</h2>
          <pre class="code">{`<Show when={slot() === "hero"}><Canvas /></Show>
<Show when={slot() === "pip"}><Canvas /></Show>
<Show when={slot() === "dock"}><Canvas /></Show>`}</pre>
          <div class="stage">
            <Show when={slot() === "hero"}>
              <div class={slotClass("hero")}>
                <Canvas />
              </div>
            </Show>
            <Show when={slot() === "pip"}>
              <div class={slotClass("pip")}>
                <Canvas />
              </div>
            </Show>
            <Show when={slot() === "dock"}>
              <div class={slotClass("dock")}>
                <Canvas />
              </div>
            </Show>
          </div>
        </article>
      </section>

      <footer class="note">
        Both panels render the same <code>&lt;Canvas /&gt;</code> component. The only difference is
        whether the JSX expression is stored in a variable and referenced (left) or written inline
        (right). On the left, every slot toggle migrates the same DOM node — the logo keeps drawing
        and splats survive. On the right, each slot evaluates a separate JSX expression, so every
        toggle produces a new element from scratch.
      </footer>
    </main>
  );
}

render(App, document.body);
