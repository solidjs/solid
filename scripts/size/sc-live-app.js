// The live server-component page: sc-base-app plus what a live page reaches
// for — `live(GET(...))` on the server-function reference, an `action` for
// the send path, and `isPending`/`latest` on the client signal (the router
// reads both, so every real page retains the verdict). Still no client
// stores: the store engine on this page, if any, is the frames client's
// container-trace materializer, which is exactly what this scenario keeps
// honest.
import { hydrate, Show, For, Loading, Errored, dynamic } from "@solidjs/web";
import { createSignal, createMemo, action, isPending, latest, lazy } from "solid-js";
import { installServerComponents } from "@solidjs/web/frames";
import { createServerReference, live, GET } from "@solidjs/web/server-functions/client";

installServerComponents();
const getStory = live(GET(createServerReference("story", "getStory")));
const Story = dynamic(() => getStory());
const send = action(async () => {});
const [n, setN] = createSignal(0);
const Page = lazy(() => import("./lazy-page.js"));
hydrate(() => {
  const d = createMemo(() => n() + (isPending(n) ? 1 : 0) + latest(n));
  setN(1);
  return [d(), Show, For, Loading, Errored, Page, Story, send];
}, document.body);
