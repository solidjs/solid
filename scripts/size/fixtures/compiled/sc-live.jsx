// `page: compiled live server components`: the compiled counterpart of
// sc-live-app.js — sc-base.jsx plus what a live page reaches for:
// `live(GET(...))` on the server-function reference, an `action` for the
// send path (dispatched from a compiled click handler), and
// `isPending` / `latest` on a client signal (the router reads both, so every
// real page retains the verdict) — read where a real page reads them, in a
// template's `class` and a text hole. Still no client stores. Rolldown
// splits this page's eager graph in two (the shared runtime in a chunk the
// entry imports statically — the scenario's ledger note in scenarios.js);
// bundle.mjs counts both.
import { hydrate, dynamicComponent } from "@solidjs/web";
import { action, createSignal, isPending, latest } from "solid-js";
import { installServerComponents } from "@solidjs/web/frames";
import { createServerReference, live, GET } from "@solidjs/web/server-functions/client";
import Shell from "./sc-shell.jsx";

installServerComponents();
const getStory = live(GET(createServerReference("story", "getStory")));
const Story = dynamicComponent(() => getStory());
const vote = action(async function* () {});

function VoteBar(props) {
  const [votes, setVotes] = createSignal(0);
  return (
    <div class={{ votes: true, pending: isPending(votes) }}>
      <button type="button" onClick={() => (setVotes(votes() + 1), vote(props.id))}>
        ▲
      </button>
      <span>{latest(votes)}</span>
    </div>
  );
}

hydrate(
  () => (
    <Shell id={1}>
      <VoteBar id={1} />
      <Story id={1} />
    </Shell>
  ),
  document.body
);
