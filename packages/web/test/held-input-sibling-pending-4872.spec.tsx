/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4872: a search box, `value={q()}` with `onInput` writing `q`, and a class
 * on the results reading `isPending(results)`. Each keystroke's write is
 * held while the search it starts is pending, so a plain `q()` reads the
 * previous query (D-34). The `isPending` flip re-runs the template's grouped
 * effect. A stateful prop is written on every run (#2016, #4186) except
 * one: an unchanged value while the effect is a stale reader of an open hold
 * (`heldRead`). The typed text stays; the landing writes the bound value.
 */
import { afterEach, expect, test, vi } from "vitest";
import { createMemo, createSignal, flush, For, isPending, latest, Loading } from "solid-js";
import { render } from "@solidjs/web";

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

type Shape = "plain" | "latest" | "spread";

async function typeMug(shape: Shape, sanitize = (v: string) => v) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const host = document.body.appendChild(document.createElement("div"));
  const [q, setQ] = createSignal("");
  const results = createMemo(() => {
    const t = q();
    if (!t) return [] as string[];
    return new Promise<string[]>(r => setTimeout(() => r([t + "-1"]), 50));
  });
  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) =>
    setQ(sanitize(e.currentTarget.value));
  const list = () => (
    <Loading fallback={<li>…</li>}>
      <For each={results()}>{r => <li>{r}</li>}</For>
    </Loading>
  );
  dispose = render(
    () =>
      shape === "latest" ? (
        <div>
          <input value={latest(q)} onInput={onInput} />
          <ul class={{ stale: isPending(results) }}>{list()}</ul>
        </div>
      ) : shape === "spread" ? (
        <div>
          <input
            {...{
              get value() {
                return q();
              },
              get class() {
                return isPending(results) ? "stale" : "";
              }
            }}
            onInput={onInput}
          />
          <ul>{list()}</ul>
        </div>
      ) : (
        <div>
          <input value={q()} onInput={onInput} />
          <ul class={{ stale: isPending(results) }}>{list()}</ul>
        </div>
      ),
    host
  );
  flush();
  const input = host.querySelector("input")!;
  const seen: string[] = [];
  for (const ch of "mug") {
    input.value += ch;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    await tick(10);
    flush();
    seen.push(input.value);
  }
  const warnings = () =>
    warn.mock.calls
      .map(c => String(c[0]))
      .filter(m => m.includes("[UNCOMMITTED_INPUT_OVERWRITTEN]"));
  return { host, input, seen, warnings };
}

for (const shape of ["plain", "latest", "spread"] as const) {
  test(`#4872 ${shape}: a sibling's re-run during the hold keeps every typed character`, async () => {
    const { host, input, seen, warnings } = await typeMug(shape);
    expect(seen).toEqual(["m", "mu", "mug"]);
    await tick(80);
    flush();
    expect(input.value).toBe("mug");
    expect(host.querySelector("ul")!.textContent).toBe("mug-1");
    expect(warnings()).toEqual([]);
  });
}

test("#4872 a sanitized write held with the search is written at the landing", async () => {
  const { input, seen } = await typeMug("plain", v => v.toUpperCase());
  // Held: the box keeps what was typed while the search is pending.
  expect(seen).toEqual(["m", "mu", "mug"]);
  await tick(80);
  flush();
  // The landing re-runs the effect: the bound value replaces the draft.
  expect(input.value).toBe("MUG");
});

test("#2016 outside a hold, a rejected edit is still written back", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const host = document.body.appendChild(document.createElement("div"));
  const [q, setQ] = createSignal("a", { equals: false });
  const [cls, setCls] = createSignal("x");
  dispose = render(() => <input value={q()} class={cls()} onInput={() => setQ(q())} />, host);
  flush();
  const input = host.querySelector("input")!;
  input.value = "ab";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
  expect(input.value).toBe("a");
  input.value = "ac";
  setCls("y");
  flush();
  // #4186 as ruled: a sibling's re-run outside a hold writes the bound value.
  expect(input.value).toBe("a");
});
