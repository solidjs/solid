// Tier-1 SSR-lane bench for link claims in server HTML (solidjs/solid#3878):
// the HN story page shape (examples/hackernews storyView + navView) over a
// 1,406-comment thread — ~1,475 anchors, ~9k nodes — rendered three ways:
//
//   - no handler: every anchor's `ssrLinkClaim` hole is `""` — the cost an
//     app without a router pays for the hole (one property read per anchor)
//   - router handler: a per-request handler in the shape of the router's
//     `managedUrl` + `linkMatcher` — location parsed once, one `URL` per
//     anchor — the cost of marking every anchor the way #654 would
//   - fast handler: the same, with the canonical-href string fast path the
//     #665 thread names as a follow-up (a root-relative href with no
//     query/hash/escapes compares as a string)
//
// Vitest's reported mean is the full `renderToString` cycle.

/**
 * @jsxImportSource @solidjs/web
 */
import { bench } from "vitest";
import { renderToString, setLinkClaim, type LinkClaimHandler } from "@solidjs/web";

// --- a deterministic thread ---------------------------------------------------
let seed = 0x9e3779b9;
function rand() {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0x100000000;
}
const USERS = ["pg", "dang", "tptacek", "patio11", "jacquesm", "rayiner", "Animats", "ryan"];
const WORDS = "the quick brown fox jumps over a lazy dog while meta ships another app".split(" ");
const text = (n: number) =>
  Array.from({ length: n }, () => WORDS[(rand() * WORDS.length) | 0]).join(" ");

interface Comment {
  id: number;
  user: string;
  time_ago: string;
  content: string;
  comments: Comment[];
}

function makeStory(total: number) {
  let made = 0;
  let id = 1;
  function comment(depth: number): Comment {
    made++;
    const c: Comment = {
      id: id++,
      user: USERS[(rand() * USERS.length) | 0] + (id % 97),
      time_ago: `${1 + ((rand() * 12) | 0)} hours`,
      content: `<p>${text(8 + ((rand() * 20) | 0))} <i>${text(2)}</i> ${text(5)}</p>`,
      comments: []
    };
    const want = depth > 6 ? 0 : (rand() * (4 - depth / 2)) | 0;
    for (let i = 0; i < want && made < total; i++) c.comments.push(comment(depth + 1));
    return c;
  }
  const roots: Comment[] = [];
  while (made < total) roots.push(comment(0));
  return {
    title: "Facebook renames itself Meta",
    url: "https://about.fb.com/news/2021/10/facebook-company-is-now-meta/",
    domain: "about.fb.com",
    points: 3521,
    user: "ryan",
    time_ago: "4 years",
    comments_count: made,
    comments: roots
  };
}

const story = makeStory(1406);
const REQUEST = "https://example.com/users/ryan56";

// --- the page -----------------------------------------------------------------
function Nav() {
  return (
    <header class="header">
      <nav class="inner">
        <a href="/">
          <strong>HN</strong>
        </a>
        <a href="/new">
          <strong>New</strong>
        </a>
        <a href="/show">
          <strong>Show</strong>
        </a>
        <a href="/ask">
          <strong>Ask</strong>
        </a>
        <a href="/job">
          <strong>Jobs</strong>
        </a>
        <a class="github" href="http://github.com/solidjs/solid" target="_blank" rel="noreferrer">
          Built with Solid
        </a>
      </nav>
    </header>
  );
}

function comment(c: Comment): any {
  return (
    <li class="comment">
      <div class="by">
        <a href={`/users/${c.user}`}>{c.user}</a> {c.time_ago} ago
      </div>
      <div class="text" innerHTML={c.content} />
      {c.comments.length ? <ul class="comment-children">{c.comments.map(comment)}</ul> : null}
    </li>
  );
}

function Story() {
  return (
    <div class="item-view">
      <div class="item-view-header">
        <a href={story.url} target="_blank">
          <h1>{story.title}</h1>
        </a>
        <span class="host">({story.domain})</span>
        <p class="meta">
          {story.points} points | by <a href={`/users/${story.user}`}>{story.user}</a>{" "}
          {story.time_ago} ago
        </p>
      </div>
      <div class="item-view-comments">
        <p class="item-view-comments-header">{story.comments_count + " comments"}</p>
        <ul class="comment-children">{story.comments.map(comment)}</ul>
      </div>
    </div>
  );
}

function Page(props: { handler?: LinkClaimHandler }) {
  if (props.handler) setLinkClaim(props.handler);
  return (
    <>
      <Nav />
      <Story />
    </>
  );
}

// --- handlers (the router's shape, solidjs/solid-router claims.ts + utils.ts) --
const mockBase = "http://sr";
const trimPathRegex = /^\/+|(\/)\/+$/g;
const normalizePath = (path: string) => {
  const s = path.replace(trimPathRegex, "$1");
  return s ? (/^[?#]/.test(s) ? s : "/" + s) : "";
};
const comparablePath = (path: string) =>
  new URL(mockBase + normalizePath(path.split(/[?#]/, 1)[0])).pathname
    .toLowerCase()
    .replace(/\/$/, "");
const comparableQuery = (search: string) => {
  const params = new URLSearchParams(search);
  params.sort();
  return params.toString();
};
function linkMatcher({ pathname, search }: URL, base: string) {
  const loc = comparablePath(pathname);
  const root = comparablePath(base);
  return (target: string) => {
    const path = comparablePath(target);
    const exact = loc === path;
    const q = target.indexOf("?");
    return {
      active: exact || (path !== "" && path !== root && loc.startsWith(path + "/")),
      current: exact && comparableQuery(search) === comparableQuery(q < 0 ? "" : target.slice(q))
    };
  };
}

function routerHandler(requestUrl: string): LinkClaimHandler {
  const location = new URL(requestUrl);
  const match = linkMatcher(location, "");
  return attrs => {
    const href = attrs.href;
    if (!href || attrs.target || attrs.download != null) return "";
    if (typeof attrs.rel === "string" && attrs.rel.split(/\s+/).includes("external")) return "";
    let url: URL;
    try {
      url = new URL(href as string, location);
    } catch {
      return "";
    }
    if (url.origin !== location.origin) return "";
    const { active, current } = match(url.pathname + url.search);
    return active ? (current ? ' data-active aria-current="page"' : " data-active") : "";
  };
}

function fastHandler(requestUrl: string): LinkClaimHandler {
  const slow = routerHandler(requestUrl);
  const location = new URL(requestUrl);
  const loc = location.pathname.toLowerCase().replace(/\/$/, "");
  const exactOnly = location.search !== "";
  return attrs => {
    const href = attrs.href;
    if (
      typeof href === "string" &&
      href.charCodeAt(0) === 47 &&
      href.charCodeAt(1) !== 47 &&
      !attrs.target &&
      attrs.download == null &&
      !attrs.rel &&
      !/[?#%]|\/\.|\/\//.test(href)
    ) {
      const path = (href.length > 1 && href.endsWith("/") ? href.slice(0, -1) : href).toLowerCase();
      if (path === loc) return exactOnly ? " data-active" : ' data-active aria-current="page"';
      return path !== "/" && loc.startsWith(path + "/") ? " data-active" : "";
    }
    return slow(attrs);
  };
}

bench("hn story page (1,475 anchors): no link handler", () => {
  renderToString(() => <Page />);
});

bench("hn story page (1,475 anchors): router link handler (URL per anchor)", () => {
  renderToString(() => <Page handler={routerHandler(REQUEST)} />);
});

bench("hn story page (1,475 anchors): fast link handler (canonical-href string path)", () => {
  renderToString(() => <Page handler={fastHandler(REQUEST)} />);
});
