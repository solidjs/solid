/**
 * @jsxImportSource @solidjs/web
 *
 * Fixture for solidjs/solid#4809: an async title as the only async read in a
 * streamed `<Loading>`. `plain` registers through `useHead` directly; `meta`
 * mirrors @solidjs/meta's `<Title>`, which wraps its children in a memo.
 * `joined` adds a slower memo still in flight when the retry joins its slot;
 * `projection` adds an async projection beside the title.
 * Shared by test/server/use-head-loading-4809.spec.tsx (writes the artifacts)
 * and test/hydration/use-head-loading-4809.spec.tsx (replays them).
 */
import { createMemo, createProjection, Loading } from "solid-js";
import { useHead } from "@solidjs/web";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function PlainTitle(props: { text: () => string }) {
  useHead({ tag: "title", props: { children: () => props.text() } });
  return null;
}

function MetaTitle(props: { children: string }) {
  const body = createMemo(() => props.children);
  useHead({
    tag: "title",
    props: {
      get children() {
        return body();
      }
    }
  });
  return null;
}

export const variants = {
  plain: () => {
    const value = createMemo(() => sleep(20).then(() => "Async Title"));
    return <PlainTitle text={value} />;
  },
  meta: () => {
    const value = createMemo(() => sleep(20).then(() => "Async Title"));
    return <MetaTitle>{value()}</MetaTitle>;
  },
  joined: () => {
    const slow = createMemo(() => sleep(40).then(() => "slow"));
    const value = createMemo(() => sleep(20).then(() => "Async Title"));
    return (
      <>
        <span>{slow()}</span>
        <PlainTitle text={value} />
      </>
    );
  },
  projection: () => {
    const state = createProjection(() => sleep(10).then(() => ({ text: "projected" })), {
      text: ""
    });
    const value = createMemo(() => sleep(20).then(() => "Async Title"));
    return (
      <>
        <span>{state.text}</span>
        <PlainTitle text={value} />
      </>
    );
  }
};
export type Variant = keyof typeof variants;

/** The async records each variant must ship, and the text its `<span>` shows. */
export const expected: Record<Variant, { records: string[]; span?: string }> = {
  plain: { records: ["0000"] },
  meta: { records: ["0000"] },
  joined: { records: ["0000", "0001"], span: "slow" },
  projection: { records: ["0000", "0001"], span: "projected" }
};

export function app(variant: Variant) {
  const Content = variants[variant];
  return () => (
    <Loading fallback={<p>loading</p>}>
      <Content />
      <main>content</main>
    </Loading>
  );
}
