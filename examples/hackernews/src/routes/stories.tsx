import {
  query,
  serverRouteComponent,
  type RouteParams,
  type ServerRouteArgs,
  type StandardSchemaV1
} from "@solidjs/router";
import * as hn from "~/server/hn";
import type { StoryTypes } from "~/types";

/** The feeds' `?page=`: a number, page 1 when absent or not one. */
export const searchSchema: StandardSchemaV1<{ page?: string }, { page: number }> = {
  "~standard": {
    version: 1,
    vendor: "hackernews",
    validate: raw => ({ value: { page: Number((raw as { page?: string }).page) || 1 } })
  }
};

type Args = ServerRouteArgs<RouteParams<"/:type?">, { page: number }>;

const getStories = query(async ({ params, search }: Args) => {
  "use server";
  const type = (params.type || "top") as StoryTypes;
  const page = search.page;
  const stories = await hn.getStories(type, page);
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
}, "stories");

// The router derives the call from the match — the `type` param and the
// schema's `page` — so changing feed or page re-calls it and the response
// morphs this boundary in place, and link hover makes the same call ahead of
// the click. `query` gives the call cache identity, so both read one entry.
export default serverRouteComponent(getStories);
