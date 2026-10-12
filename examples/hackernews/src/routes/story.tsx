import { serverRouteComponent, type RouteParams, type ServerRouteArgs } from "@solidjs/router";
import { respond } from "@solidjs/web";
import { GET } from "@solidjs/web/server-functions";
import { cacheable } from "~/server/cache";
import * as hn from "~/server/hn";
import type { CommentDefinition } from "~/types";

const getStory = GET(async ({ params }: ServerRouteArgs<RouteParams<"/stories/:id">>) => {
  "use server";
  const story = await hn.getStory(params.id);
  return respond(
    () => (
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
          <ul class="comment-children">
            {story.comments.map(comment => (
              <Comment comment={comment} />
            ))}
          </ul>
        </div>
      </div>
    ),
    cacheable
  );
});

/**
 * Recursive, and entirely server markup. The collapse is a native
 * `<details>`, so the client never sees the tree or anything about it.
 */
function Comment(props: { comment: CommentDefinition }) {
  const c = props.comment;
  return (
    <li class="comment">
      <div class="by">
        <a href={`/users/${c.user}`}>{c.user}</a> {c.time_ago} ago
      </div>
      <div class="text" innerHTML={c.content} />
      {c.comments.length ? (
        <details class="toggle" open>
          <summary>
            <span class="open-label">[-]</span>
            <span class="closed-label">[+] comments collapsed</span>
          </summary>
          <ul class="comment-children">
            {c.comments.map(reply => (
              <Comment comment={reply} />
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

// Nothing for the client to fill, so it is a server route like the feeds and
// the user page.
export default serverRouteComponent(getStory);
