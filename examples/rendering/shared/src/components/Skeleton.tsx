import { createMemo, createSignal, createStore, For, isPending } from "solid-js";

interface Feed {
  user: string;
  provisional?: boolean;
  items: { text: string }[];
}

// Default data, not a fallback tree: dummy items with the same shape and
// sentence structure as the real thing, rendered by the real template. The
// affordance is encoded in the data itself (`provisional`) — it drives a
// small inline indicator and dimmed text, nothing structural.
const placeholderFeed = (): Feed => ({
  user: "",
  provisional: true,
  items: [
    { text: "Shipped release #—" },
    { text: "Reviewed — pull requests" },
    { text: "Closed — issues" }
  ]
});

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let fetchCount = 0;
async function fetchFeed(): Promise<Feed> {
  await wait(1200);
  const run = ++fetchCount;
  return {
    user: "Ada",
    items: [
      { text: `Shipped release #${run}` },
      { text: `Reviewed ${run + 2} pull requests` },
      { text: `Closed ${run * 3} issues` }
    ]
  };
}

function FeedCard(props: { feed: Feed }) {
  return (
    <div
      class={["feed-card", { provisional: !!props.feed.provisional }]}
      aria-busy={props.feed.provisional ? "true" : "false"}
    >
      <h2>
        {props.feed.user || "Someone"}'s activity
        <span class="loading-dot" />
      </h2>
      <ul>
        <For each={props.feed.items}>{item => <li>{item.text}</li>}</For>
      </ul>
    </div>
  );
}

const Skeleton = () => {
  const [version, setVersion] = createSignal(0);

  const feed = createMemo<Feed>(
    async () => {
      version(); // track: bumping refetches
      return fetchFeed();
    },
    { loadingValue: placeholderFeed() }
  );

  const [store] = createStore<Feed>(
    async draft => {
      version();
      const data = await fetchFeed();
      draft.user = data.user;
      draft.items = data.items;
      draft.provisional = false;
    },
    placeholderFeed(),
    { seedLoadingValue: true }
  );

  return (
    <section class={["feed", { pending: isPending(feed) || isPending(() => store.items) }]}>
      <h1>Loading Value</h1>
      <p>
        Both cards declare commit #0 — the memo via <code>loadingValue</code>, the derived store via{" "}
        <code>seedLoadingValue</code>. This is the "default data" pattern: the real template renders
        real-looking dummy items from frame one, and the loading affordance is encoded in the data
        itself (a <code>provisional</code> flag driving the dot and dimmed text) — there is no
        fallback tree and nothing suspends. During SSR the dummy items are what stream in the shell;
        on client navigation the page mounts fresh and opens a new loading window. Refetches are
        different: the question is already answered, so <code>isPending</code> dims the section
        instead.
      </p>
      <div style={{ display: "flex", gap: "2em", "flex-wrap": "wrap" }}>
        <div>
          <h2>createMemo + loadingValue</h2>
          <FeedCard feed={feed()} />
        </div>
        <div>
          <h2>createStore + seedLoadingValue</h2>
          <FeedCard feed={store} />
        </div>
      </div>
      <button type="button" onClick={() => setVersion(v => v + 1)}>
        Refetch
      </button>
    </section>
  );
};

export default Skeleton;
