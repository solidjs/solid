/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { Loading, action, createMemo, createSignal, flush } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
  }
};

function mount(heading: boolean) {
  const answers = new Map<number, (text: string) => void>();
  const fetchPage = (id: number) => new Promise<string>(resolve => answers.set(id, resolve));
  let release!: () => void;
  let navigate!: () => unknown;
  function App() {
    const [id, setId] = createSignal(0);
    const content = createMemo(() => fetchPage(id()));
    navigate = action(function* () {
      setId(1);
      yield new Promise<void>(resolve => (release = resolve));
    });
    return (
      <main>
        {heading && <h2>Page {id()}</h2>}
        <p>
          <Loading fallback="Loading…">{content()}</Loading>
        </p>
      </main>
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <App />, container);
  return {
    text: () => container.textContent,
    navigate: () => navigate(),
    answer: (id: number, text: string) => answers.get(id)!(text),
    release: () => release(),
    dispose: () => (dispose(), container.remove())
  };
}

test("#5162: a Loading does not reveal page 1's content beside a heading an open action keeps on page 0", async () => {
  const app = mount(true);
  await tick();
  expect(app.text()).toBe("Page 0Loading…");
  app.navigate();
  await tick();
  app.answer(1, "Content for page 1");
  await tick();
  expect(app.text()).toBe("Page 0Loading…");
  app.release();
  await tick();
  expect(app.text()).toBe("Page 1Content for page 1");
  app.dispose();
});

test("#2937: with no heading, the content reveals at its landing while the action is open", async () => {
  const app = mount(false);
  await tick();
  expect(app.text()).toBe("Loading…");
  app.navigate();
  await tick();
  app.answer(1, "Content for page 1");
  await tick();
  expect(app.text()).toBe("Content for page 1");
  app.release();
  await tick();
  expect(app.text()).toBe("Content for page 1");
  app.dispose();
});
