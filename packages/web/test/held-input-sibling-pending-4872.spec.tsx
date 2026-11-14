/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4872: a search box, `value={q()}` with `onInput` writing `q`, and a class
 * on the results reading `isPending(results)`. Each keystroke's write is
 * held while the search it starts is pending, so a plain `q()` reads the
 * previous query (D-34). The `isPending` flip re-runs the template's grouped
 * effect, which re-applies `value` (no equality guard, #4186) — the held
 * previous query — over the typed text. The dev warning names that case and
 * `latest(q)`, which binds the held write as it is typed.
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

async function typeMug(ahead: boolean) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const host = document.body.appendChild(document.createElement("div"));
  const [q, setQ] = createSignal("");
  const results = createMemo(() => {
    const t = q();
    if (!t) return [] as string[];
    return new Promise<string[]>(r => setTimeout(() => r([t + "-1"]), 50));
  });
  dispose = render(
    () =>
      ahead ? (
        <div>
          <input value={latest(q)} onInput={e => setQ(e.currentTarget.value)} />
          <ul class={{ stale: isPending(results) }}>
            <Loading fallback={<li>…</li>}>
              <For each={results()}>{r => <li>{r}</li>}</For>
            </Loading>
          </ul>
        </div>
      ) : (
        <div>
          <input value={q()} onInput={e => setQ(e.currentTarget.value)} />
          <ul class={{ stale: isPending(results) }}>
            <Loading fallback={<li>…</li>}>
              <For each={results()}>{r => <li>{r}</li>}</For>
            </Loading>
          </ul>
        </div>
      ),
    host
  );
  flush();
  const input = host.querySelector("input")!;
  for (const ch of "mug") {
    input.value += ch;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    await tick(10);
    flush();
  }
  const warnings = warn.mock.calls
    .map(c => String(c[0]))
    .filter(m => m.includes("[UNCOMMITTED_INPUT_OVERWRITTEN]"));
  return { input, warnings };
}

test("#4872 a held value={q()} re-applied by a sibling isPending binding warns, naming the held write", async () => {
  const { input, warnings } = await typeMug(false);
  expect(input.value).not.toBe("mug");
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("or it was and the write is held");
  expect(warnings[0]).toContain("bind `latest(value)`");
});

test("#4872 value={latest(q)} keeps every typed character", async () => {
  const { input, warnings } = await typeMug(true);
  expect(input.value).toBe("mug");
  expect(warnings).toEqual([]);
});
