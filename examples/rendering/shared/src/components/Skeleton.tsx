import { createMemo, createSignal, createStore, For, isPending } from "solid-js";

interface FeedItem {
  text: string;
  placeholder?: boolean;
}

interface Feed {
  user: string;
  items: FeedItem[];
}

// The loading value is shaped like the answer: a feed whose items just
// haven't arrived yet. There is no fallback tree — these placeholder items
// render through the same template as the real ones.
const placeholderFeed = (): Feed => ({
  user: "",
  items: [
    { text: "", placeholder: true },
    { text: "", placeholder: true },
    { text: "", placeholder: true }
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
    <div class="feed-card" aria-busy={!props.feed.user}>
      <h2 class={{ placeholder: !props.feed.user }}>{props.feed.user || "Someone"}'s activity</h2>
      <ul>
        <For each={props.feed.items}>
          {item => <li class={{ placeholder: item.placeholder }}>{item.text}</li>}
        </For>
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
    },
    placeholderFeed(),
    { seedLoadingValue: true }
  );

  return (
    <section class={["feed", { pending: isPending(feed) || isPending(() => store.items) }]}>
      <h1>Loading Value</h1>
      <p>
        Both cards declare commit #0 — the memo via <code>loadingValue</code>, the derived store via{" "}
        <code>seedLoadingValue</code>. The loading value isn't a fallback branch: it's data shaped
        like the answer (a feed of items that haven't arrived), rendered by the exact same template
        as the real thing. On first load nothing suspends — during SSR the placeholder rows are what
        stream in the shell, and on client navigation this page mounts fresh and opens a new loading
        window. Refetches are different: the question is already answered, so <code>isPending</code>{" "}
        dims the section instead.
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
