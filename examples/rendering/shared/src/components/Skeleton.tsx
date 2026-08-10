import { createMemo, createSignal, For, isPending, Show } from "solid-js";

interface Feed {
  skeleton: boolean;
  user: string;
  items: string[];
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let fetchCount = 0;
async function fetchFeed(): Promise<Feed> {
  await wait(1200);
  const run = ++fetchCount;
  return {
    skeleton: false,
    user: "Ada",
    items: [
      `Shipped release #${run}`,
      `Reviewed ${run + 2} pull requests`,
      `Closed ${run * 3} issues`
    ]
  };
}

// The loading value is commit #0: the memo is born committed with it, so the
// first fetch never suspends — no <Loading> boundary anywhere on this page.
// The skeleton flag is value-channel provenance: the UI branches on the data
// itself to decide what to show, and `isPending` stays false through the
// first flight (it reports refetches of an already-answered question).
const Skeleton = () => {
  const [version, setVersion] = createSignal(0);
  const feed = createMemo<Feed>(
    async () => {
      version(); // track: bumping refetches
      return fetchFeed();
    },
    { loadingValue: { skeleton: true, user: "", items: [] } }
  );

  return (
    <section class={["feed", { pending: isPending(feed) }]}>
      <h1>Loading Value</h1>
      <p>
        This memo declares a <code>loadingValue</code> — commit #0. On first load it renders the
        skeleton below instead of suspending to a <code>Loading</code> boundary: during SSR the
        skeleton is what streams in the shell (the real data follows as it lands), and on client
        navigation this page mounts fresh and opens a new loading window. Refetches are different:
        the question is already answered, so <code>isPending</code> drives the dim instead.
      </p>
      <Show
        when={!feed().skeleton}
        fallback={
          <div class="feed-card" aria-busy="true">
            <div class="skeleton-line" style={{ width: "40%" }} />
            <div class="skeleton-line" style={{ width: "85%" }} />
            <div class="skeleton-line" style={{ width: "70%" }} />
            <div class="skeleton-line" style={{ width: "75%" }} />
          </div>
        }
      >
        <div class="feed-card">
          <h2>{feed().user}'s activity</h2>
          <ul>
            <For each={feed().items}>{item => <li>{item}</li>}</For>
          </ul>
        </div>
      </Show>
      <button type="button" onClick={() => setVersion(v => v + 1)}>
        Refetch
      </button>
    </section>
  );
};

export default Skeleton;
