/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4873: content an `<Errored>` replaces with its fallback is kept alive for
 * `reset()`, so its `useHead` registrations were never withdrawn: the error
 * page kept the failed page's title. Behind a fallback the content is not on
 * screen (F-3), nor are its head tags; they come back when it reveals.
 */
import { afterEach, expect, test } from "vitest";
import { createMemo, createSignal, Errored, flush, Loading } from "solid-js";
import { render, useHead } from "@solidjs/web";

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => {
  flush();
  await tick();
  flush();
  await tick();
};
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

function Page(props: { title: string }) {
  useHead([
    {
      tag: "title",
      props: {
        get children() {
          return props.title;
        }
      }
    },
    {
      tag: "meta",
      props: {
        name: "description",
        get content() {
          return props.title + " summary";
        }
      }
    }
  ]);
  return <p>post</p>;
}
const description = () =>
  document.head.querySelector('meta[name="description"]')?.getAttribute("content");

test("#4873 head tags of content replaced by an Errored fallback are withdrawn, and come back on reset", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const [fail, setFail] = createSignal(false);
  let reset!: () => void;
  dispose = render(() => {
    useHead({ tag: "title", props: { children: "App" } });
    const data = createMemo(() => {
      if (fail()) throw new Error("not found");
      return 1;
    });
    return (
      <Errored
        fallback={(_, r) => {
          reset = r;
          return <p>error</p>;
        }}
      >
        {data() && <Page title="Post 1" />}
      </Errored>
    );
  }, host);
  await settle();
  expect(document.title).toBe("Post 1");
  expect(description()).toBe("Post 1 summary");

  setFail(true);
  await settle();
  expect(host.textContent).toBe("error");
  expect(document.title).toBe("App");
  expect(description()).toBeUndefined();

  setFail(false);
  reset();
  await settle();
  expect(host.textContent).toBe("post");
  expect(document.title).toBe("Post 1");
  expect(description()).toBe("Post 1 summary");
});

test("#4873 an error fallback's own head tags win while it shows", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const [fail, setFail] = createSignal(false);
  dispose = render(() => {
    useHead({ tag: "title", props: { children: "App" } });
    const data = createMemo(() => {
      if (fail()) throw new Error("not found");
      return 1;
    });
    return (
      <Errored
        fallback={() => {
          useHead({ tag: "title", props: { children: "Not found" } });
          return <p>error</p>;
        }}
      >
        {data() && <Page title="Post 1" />}
      </Errored>
    );
  }, host);
  await settle();
  expect(document.title).toBe("Post 1");
  setFail(true);
  await settle();
  expect(document.title).toBe("Not found");
});

test("#4873 a rejected async page behind an Errored fallback leaves the app title", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const [id, setId] = createSignal(1);
  dispose = render(() => {
    useHead({ tag: "title", props: { children: "App" } });
    const post = createMemo(() => {
      const n = id();
      return n === 99
        ? Promise.reject(new Error("not found"))
        : Promise.resolve({ title: "Post " + n });
    });
    return (
      <Loading fallback={<p>loading</p>}>
        <Errored fallback={() => <p>error</p>}>
          <Page title={post().title} />
        </Errored>
      </Loading>
    );
  }, host);
  await settle();
  expect(document.title).toBe("Post 1");
  setId(99);
  await settle();
  expect(host.textContent).toBe("error");
  expect(document.title).toBe("App");
});
