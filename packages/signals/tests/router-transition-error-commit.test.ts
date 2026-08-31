import {
  createEffect,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

afterEach(() => flush());

it("commits a source write and its effect when a downstream async error is handled", async () => {
  const error = new Error("lazy route failed");
  let reject!: (error: unknown) => void;
  const [route, setRoute] = createSignal("/", { ownedWrite: true });
  let rendered = "";
  let external = "/";

  createRoot(() => {
    const lazyRoute = createMemo(() => {
      if (route() === "/") return "home";
      return new Promise<string>((_, fail) => (reject = fail));
    });
    const boundary = createErrorBoundary(
      () => lazyRoute(),
      caught => {
        expect(caught()).toBe(error);
        return "error";
      }
    );
    createRenderEffect(boundary, value => {
      rendered = value;
    });
    createEffect(
      route,
      value => {
        external = value;
      },
      { defer: true }
    );
  });

  flush();
  expect(rendered).toBe("home");

  setRoute("/plugins");
  flush();
  expect(route()).toBe("/");
  expect(rendered).toBe("home");
  expect(external).toBe("/");

  reject(error);
  await Promise.resolve();
  await Promise.resolve();
  flush();

  expect(rendered).toBe("error");
  expect(route()).toBe("/plugins");
  expect(external).toBe("/plugins");
});
