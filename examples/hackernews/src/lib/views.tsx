"use server";
// The server components. A `"use server"` function that RETURNS a function is
// a server component: the function's ARGUMENTS are server inputs (ids, feed,
// page), and the returned component's PROPS are client positions — holes the
// client fills that never travel to the server.
//
// Every view below renders the exact markup its ../hackernews-spa counterpart
// renders in the browser. The difference is where it exists: here it is HTML
// produced once on the server, and the data behind it (a 1,406-comment thread)
// never crosses the wire. In the SPA twin that same thread arrives twice — as
// the HTML the server painted and again as the JSON that produced it.
import { getStories, getStory, getUser } from "./hn";
import type { CommentDefinition, StoryTypes } from "~/types";

/**
 * A client position. The server calls it where client-owned markup belongs and
 * the client renders its own component there. Only primitives and a single
 * `children` JSX position cross this boundary: `children` has creation-time
 * hydration-key parity on both sides, which arbitrary JSX props do not.
 *
 * `$key` names the occurrence by entity, so the client wrapper's state follows
 * that comment across refetches instead of being positional.
 */
type Slot = (props: { $key?: string | number; children?: unknown }) => unknown;

export async function navView() {
  return () => (
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

export async function storiesView(type: StoryTypes, page: number) {
  const stories = await getStories(type, page);
  return () => (
    <div class="news-view">
      <div class="news-list-nav">
        {page > 1 ? (
          <a class="page-link" href={`/${type}?page=${page - 1}`} aria-label="Previous Page">
            {"<"} prev
          </a>
        ) : (
          <span class="page-link disabled" aria-disabled="true">
            {"<"} prev
          </span>
        )}
        <span>page {page}</span>
        {stories.length >= 29 ? (
          <a class="page-link" href={`/${type}?page=${page + 1}`} aria-label="Next Page">
            more {">"}
          </a>
        ) : (
          <span class="page-link disabled" aria-disabled="true">
            more {">"}
          </span>
        )}
      </div>
      <main class="news-list">
        {stories.map(story => (
          <li class="news-item">
            <span class="score">{story.points}</span>
            <span class="title">
              {story.url ? (
                <>
                  <a href={story.url} target="_blank" rel="noreferrer">
                    {story.title}
                  </a>
                  <span class="host"> ({story.domain})</span>
                </>
              ) : (
                <a href={`/stories/${story.id}`}>{story.title}</a>
              )}
            </span>
            <br />
            <span class="meta">
              {story.type !== "job" ? (
                <>
                  by <a href={`/users/${story.user}`}>{story.user}</a> {story.time_ago} |{" "}
                  <a href={`/stories/${story.id}`}>
                    {story.comments_count ? `${story.comments_count} comments` : "discuss"}
                  </a>
                </>
              ) : (
                <a href={`/stories/${story.id}`}>{story.time_ago}</a>
              )}
            </span>
            {story.type !== "link" ? (
              <>
                {" "}
                <span class="label">{story.type}</span>
              </>
            ) : null}
          </li>
        ))}
      </main>
    </div>
  );
}

export async function storyView(id: string) {
  const story = await getStory(id);

  /**
   * Recursive single-copy composition. A comment's own byline and text are
   * plain server markup; only the collapse control is client-owned, so the
   * replies list is handed to the `toggle` slot — the client renders the SPA's
   * Toggle there and the nested comments inside it are server markup again.
   * Each subtree therefore streams as HTML exactly once, at any depth.
   */
  const comment = (c: CommentDefinition, toggle: Slot): unknown => (
    <li class="comment">
      <div class="by">
        <a href={`/users/${c.user}`}>{c.user}</a> {c.time_ago} ago
      </div>
      <div class="text" innerHTML={c.content} />
      {c.comments.length
        ? toggle({ $key: c.id, children: c.comments.map(child => comment(child, toggle)) })
        : null}
    </li>
  );

  return (props: { toggle: Slot }) => (
    <div class="item-view">
      <div class="item-view-header">
        <a href={story.url} target="_blank">
          <h1>{story.title}</h1>
        </a>
        {story.domain ? <span class="host">({story.domain})</span> : null}
        <p class="meta">
          {story.points} points | by <a href={`/users/${story.user}`}>{story.user}</a>{" "}
          {story.time_ago} ago
        </p>
      </div>
      <div class="item-view-comments">
        <p class="item-view-comments-header">
          {story.comments_count ? story.comments_count + " comments" : "No comments yet."}
        </p>
        <ul class="comment-children">{story.comments.map(c => comment(c, props.toggle))}</ul>
      </div>
    </div>
  );
}

export async function userView(id: string) {
  const user = await getUser(id);
  return () => (
    <div class="user-view">
      <h1>User : {user.id}</h1>
      <ul class="meta">
        <li>
          <span class="label">Created:</span> {user.created}
        </li>
        <li>
          <span class="label">Karma:</span> {user.karma}
        </li>
        {user.about ? <li innerHTML={user.about} class="about" /> : null}
      </ul>
      <p class="links">
        <a href={`https://news.ycombinator.com/submitted?id=${user.id}`}>submissions</a> |{" "}
        <a href={`https://news.ycombinator.com/threads?id=${user.id}`}>comments</a>
      </p>
    </div>
  );
}
