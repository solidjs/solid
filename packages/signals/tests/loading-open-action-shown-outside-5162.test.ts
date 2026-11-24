/**
 * #5162 (F-1, F-4): a first load an open action's write re-asked reveals at
 * its landing (#2937) only while the screen shows that write nowhere outside
 * the boundary. Beside a render effect that still shows the frame before the
 * write, the content waits for the action's commit.
 */
import { expect, test } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Screen = { head: string; content: string };
type Build = (id: () => number, ask: (key: string) => Promise<string>, screen: Screen) => void;

const loading = (content: () => string, screen: Screen) => {
  const out = untrack(() =>
    createLoadingBoundary(
      () => "content=" + content(),
      () => "loading"
    )
  );
  createRenderEffect(out, v => void (screen.content = String(v)));
};

function mount(build: Build, guess = false) {
  const flights = new Map<string, (v: string) => void>();
  const ask = (key: string) => new Promise<string>(r => flights.set(key, r));
  const [id, setId] = guess ? createOptimistic(0) : createSignal(0);
  const screen: Screen = { head: "", content: "" };
  const frames: string[] = [];
  let release!: () => void;
  const navigate = action(function* () {
    setId(1);
    yield new Promise<void>(r => (release = r));
  });
  const dispose = createRoot(d => (build(id, ask, screen), d));
  return {
    answer: (key: string, v: string) => flights.get(key)!(v),
    frame: async () => (await tick(), frames.push(`${screen.head} ${screen.content}`)),
    frames,
    navigate,
    release: () => release(),
    dispose
  };
}

/** The write, then page 1's answer while the action is open, then its end. */
async function answerThenRelease(build: Build, guess = false) {
  const t = mount(build, guess);
  flush();
  await t.frame();
  t.navigate();
  flush();
  await t.frame();
  t.answer("c:1", "page1");
  await t.frame();
  t.release();
  await t.frame();
  t.dispose();
  return t.frames;
}

const held = (h0: string, h1: string) => [
  `${h0} loading`,
  `${h0} loading`,
  `${h0} loading`,
  `${h1} content=page1`
];

test("the content waits for the commit beside a heading that shows the selection", async () => {
  expect(
    await answerThenRelease((id, ask, screen) => {
      const content = createMemo(() => ask("c:" + id()));
      createRenderEffect(id, v => void (screen.head = "id=" + v));
      loading(content, screen);
    })
  ).toEqual(held("id=0", "id=1"));
});

test("the heading reads the selection through a memo (F-1)", async () => {
  expect(
    await answerThenRelease((id, ask, screen) => {
      const content = createMemo(() => ask("c:" + id()));
      const label = createMemo(() => "p" + id());
      createRenderEffect(label, v => void (screen.head = v));
      loading(content, screen);
    })
  ).toEqual(held("p0", "p1"));
});

test("the content reads the selection through a memo (F-1)", async () => {
  expect(
    await answerThenRelease((id, ask, screen) => {
      const key = createMemo(() => "c:" + id());
      const content = createMemo(() => ask(key()));
      createRenderEffect(id, v => void (screen.head = "id=" + v));
      loading(content, screen);
    })
  ).toEqual(held("id=0", "id=1"));
});

test("the heading is another boundary's shown content", async () => {
  expect(
    await answerThenRelease((id, ask, screen) => {
      const content = createMemo(() => ask("c:" + id()));
      const head = untrack(() =>
        createLoadingBoundary(
          () => "h" + id(),
          () => "loading head"
        )
      );
      createRenderEffect(head, v => void (screen.head = String(v)));
      loading(content, screen);
    })
  ).toEqual(held("h0", "h1"));
});

test("a heading behind its own fallback is not on screen: the content reveals at its landing (F-3)", async () => {
  expect(
    await answerThenRelease((id, ask, screen) => {
      const content = createMemo(() => ask("c:" + id()));
      const never = createMemo(() => ask("never"));
      const head = untrack(() =>
        createLoadingBoundary(
          () => "h" + id() + never(),
          () => "loading head"
        )
      );
      createRenderEffect(head, v => void (screen.head = String(v)));
      loading(content, screen);
    })
  ).toEqual([
    "loading head loading",
    "loading head loading",
    "loading head content=page1",
    "loading head content=page1"
  ]);
});

test("the action ends first: the heading shows, the content stays loading until its answer", async () => {
  const t = mount((id, ask, screen) => {
    const content = createMemo(() => ask("c:" + id()));
    createRenderEffect(id, v => void (screen.head = "id=" + v));
    loading(content, screen);
  });
  flush();
  await t.frame();
  t.navigate();
  flush();
  await t.frame();
  t.release();
  await t.frame();
  t.answer("c:1", "page1");
  await t.frame();
  t.dispose();
  expect(t.frames).toEqual(["id=0 loading", "id=0 loading", "id=1 loading", "id=1 content=page1"]);
});

test("#2937: a selection only the content shows still reveals at its landing", async () => {
  expect(
    await answerThenRelease((id, ask, screen) => {
      const content = createMemo(() => ask("c:" + id()));
      loading(() => id() + content(), screen);
    })
  ).toEqual([" loading", " loading", " content=1page1", " content=1page1"]);
});

test("a user effect outside the boundary is not on screen: the content reveals at its landing", async () => {
  expect(
    await answerThenRelease((id, ask, screen) => {
      const content = createMemo(() => ask("c:" + id()));
      createEffect(id, () => {});
      loading(content, screen);
    })
  ).toEqual([" loading", " loading", " content=page1", " content=page1"]);
});

test("a heading that reads ahead shows the write, and the content reveals at its landing", async () => {
  expect(
    await answerThenRelease((id, ask, screen) => {
      const content = createMemo(() => ask("c:" + id()));
      createRenderEffect(
        () => latest(id),
        v => void (screen.head = "id=" + v)
      );
      loading(content, screen);
    })
  ).toEqual(["id=0 loading", "id=1 loading", "id=1 content=page1", "id=1 content=page1"]);
});

test("a guessed selection shows in the heading, and the content reveals at its landing", async () => {
  const frames = await answerThenRelease((id, ask, screen) => {
    const content = createMemo(() => ask("c:" + id()));
    createRenderEffect(id, v => void (screen.head = "id=" + v));
    loading(content, screen);
  }, true);
  expect(frames.slice(0, 3)).toEqual(["id=0 loading", "id=1 loading", "id=1 content=page1"]);
});

test("the fallback reads the selection: it goes when the content reveals, so the content reveals at its landing (F-3)", async () => {
  expect(
    await answerThenRelease((id, ask, screen) => {
      const content = createMemo(() => ask("c:" + id()));
      const out = untrack(() =>
        createLoadingBoundary(
          () => "content=" + content(),
          () => "loading " + id()
        )
      );
      createRenderEffect(out, v => void (screen.content = String(v)));
    })
  ).toEqual([" loading 0", " loading 0", " content=page1", " content=page1"]);
});

test("a render effect the fallback owns is not outside the boundary (F-3)", async () => {
  expect(
    await answerThenRelease((id, ask, screen) => {
      const content = createMemo(() => ask("c:" + id()));
      const out = untrack(() =>
        createLoadingBoundary(
          () => "content=" + content(),
          () => {
            createRenderEffect(id, v => void (screen.head = "fb=" + v));
            return "loading";
          }
        )
      );
      createRenderEffect(out, v => void (screen.content = String(v)));
    })
  ).toEqual(["fb=0 loading", "fb=0 loading", "fb=0 content=page1", "fb=0 content=page1"]);
});

test("a heading disposed while the action is open holds nothing: the content reveals at its landing (F-3)", async () => {
  let drop!: () => void;
  const t = mount((id, ask, screen) => {
    const content = createMemo(() => ask("c:" + id()));
    createRoot(d => {
      drop = d;
      createRenderEffect(id, v => void (screen.head = "id=" + v));
    });
    loading(content, screen);
  });
  flush();
  await t.frame();
  t.navigate();
  flush();
  await t.frame();
  drop();
  flush();
  t.answer("c:1", "page1");
  await t.frame();
  t.release();
  await t.frame();
  t.dispose();
  expect(t.frames).toEqual([
    "id=0 loading",
    "id=0 loading",
    "id=0 content=page1",
    "id=0 content=page1"
  ]);
});

test("a held diamond lattice under the content is walked once per node", async () => {
  const start = performance.now();
  expect(
    await answerThenRelease((id, ask, screen) => {
      let c = createMemo(() => id());
      for (let i = 0; i < 40; i++) {
        const p = c;
        const a = createMemo(() => p() + 1);
        const b = createMemo(() => p() + 2);
        c = createMemo(() => a() + b() - 2 * p() - 3 + p());
      }
      const top = c;
      const content = createMemo(() => ask("c:" + top()));
      loading(content, screen);
    })
  ).toEqual([" loading", " loading", " content=page1", " content=page1"]);
  expect(performance.now() - start).toBeLessThan(1000);
});
