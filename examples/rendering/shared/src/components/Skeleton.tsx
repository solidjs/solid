import { createMemo, createSignal, createStore, For, isPending, Show } from "solid-js";

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

function SkeletonCard() {
  return (
    <div class="feed-card" aria-busy="true">
      <div class="skeleton-line" style={{ width: "40%" }} />
      <div class="skeleton-line" style={{ width: "85%" }} />
      <div class="skeleton-line" style={{ width: "70%" }} />
      <div class="skeleton-line" style={{ width: "75%" }} />
    </div>
  );
}

function FeedCard(props: { user: string; items: string[] }) {
  return (
    <div class="feed-card">
      <h2>{props.user}'s activity</h2>
      <ul>
        <For each={props.items}>{item => <li>{item}</li>}</For>
      </ul>
    </div>
  );
}

// Commit #0, both forms: the memo is born committed with its loadingValue and
// the derived store with its seed (seedLoadingValue promotes it from draft to
// first committed value). Neither first fetch suspends — no <Loading>
// boundary on this page. The skeleton flag is value-channel provenance: the
// UI branches on the data itself, and `isPending` stays false through the
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

  const [store] = createStore<Feed>(
    async draft => {
      version();
      const data = await fetchFeed();
      draft.user = data.user;
      draft.items = data.items;
      draft.skeleton = false;
    },
    { skeleton: true, user: "", items: [] },
    { seedLoadingValue: true }
  );

  return (
    <section class={["feed", { pending: isPending(feed) || isPending(() => store.items) }]}>
      <h1>Loading Value</h1>
      <p>
        Both cards declare commit #0 — the memo via <code>loadingValue</code>, the derived store via{" "}
        <code>seedLoadingValue</code> — so the first load renders skeletons instead of suspending to
        a <code>Loading</code> boundary. During SSR the skeletons are what stream in the shell (the
        real data follows as it lands), and on client navigation this page mounts fresh and opens
        new loading windows. Refetches are different: the question is already answered, so{" "}
        <code>isPending</code> drives the dim instead.
      </p>
      <div style={{ display: "flex", gap: "2em", "flex-wrap": "wrap" }}>
        <div>
          <h2>createMemo + loadingValue</h2>
          <Show when={!feed().skeleton} fallback={<SkeletonCard />}>
            <FeedCard user={feed().user} items={feed().items} />
          </Show>
        </div>
        <div>
          <h2>createStore + seedLoadingValue</h2>
          <Show when={!store.skeleton} fallback={<SkeletonCard />}>
            <FeedCard user={store.user} items={store.items} />
          </Show>
        </div>
      </div>
      <button type="button" onClick={() => setVersion(v => v + 1)}>
        Refetch
      </button>
    </section>
  );
};

export default Skeleton;
