/**
 * @jsxImportSource @solidjs/web
 *
 * #4316 follow-up: a `<Loading>` fragment failing while parked in an
 * enclosing fragment still pending, with a nested `<Loading>` that settled
 * into the enclosing fragment first (the parity shapes are in
 * test/server/hydration-harness.spec.tsx). The enclosing fragment holds
 * the failure either way, never a blank region settled as a success:
 * - the `<Errored>` around the settled nested fragment draws its fallback
 *   in the enclosing fragment, the settled fragment's markup gone with it;
 * - an `<Errored>` inside the settled nested fragment has its markup out of
 *   the enclosing fragment's own (it went in with that fragment's settled
 *   markup), so the enclosing fragment fails: the client renders it, where
 *   that `<Errored>` meets the failure.
 */
import { describe, expect, test } from "vitest";
import { Errored, Loading, createMemo } from "solid-js";
import { recordStream } from "./artifact-recorder.js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function App(props: { inside: boolean }) {
  const outer = createMemo(async () => (await sleep(15), "outer"));
  const mid = createMemo(async () => (await sleep(2), "mid"));
  const user = createMemo(async (): Promise<string> => {
    await sleep(5);
    throw new Error("no user 7");
  });
  // Thunks, so each boundary is created at its position.
  const errored = (children: () => any) => (
    <Errored fallback={(e: any) => <h2>caught: {e().message}</h2>}>
      <section>{children()}</section>
    </Errored>
  );
  const inner = () => (
    <Loading fallback={<i>loading</i>}>
      <span>user:{user()}</span>
    </Loading>
  );
  const nested = (children: () => any) => (
    <Loading fallback={<i>mid loading</i>}>
      <em>{mid()}</em>
      {children()}
    </Loading>
  );
  return (
    <div>
      <Loading fallback={<i>outer loading</i>}>
        <b>{outer()}</b>
        {props.inside ? nested(() => errored(inner)) : errored(() => nested(inner))}
      </Loading>
      <span>tail</span>
    </div>
  );
}

const fragments = (rest: string) =>
  [...rest.matchAll(/<template id="([^"]+)"( e)?>([\s\S]*?)<\/template>/g)].map(m => ({
    id: m[1],
    failed: !!m[2],
    html: m[3]
  }));

describe("#4316: a parked failure beside a nested fragment that settled first", () => {
  test("the Errored around the settled fragment draws its fallback in the enclosing one", async () => {
    const { shell, rest } = await recordStream(() => <App inside={false} />, { onError() {} });
    const outer = fragments(rest).find(f => shell.includes(`<template id="pl-${f.id}">`))!;
    expect(outer.failed).toBe(false);
    expect(outer.html).toContain("caught: <!--$-->no user 7<!--/--></h2>");
    expect(outer.html).not.toContain("<section");
    expect(rest).not.toContain("mid</em>");
  });

  test("an Errored inside the settled fragment: the enclosing fragment fails", async () => {
    const { shell, rest } = await recordStream(() => <App inside={true} />, { onError() {} });
    const outer = fragments(rest).find(f => shell.includes(`<template id="pl-${f.id}">`))!;
    expect(outer.failed).toBe(true);
    expect(rest).not.toMatch(/<section[^>]*><\/section>/);
    expect(rest).toContain('new Error("no user 7")');
  });
});
