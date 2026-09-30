import { query, type RoutePreloadFuncArgs, type RouteSectionProps } from "@solidjs/router";
import { dynamic } from "@solidjs/web";
import * as hn from "~/server/hn";
import type { StoryTypes } from "~/types";

const getStories = query(async (type: StoryTypes, page: number) => {
  "use server";
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

/** `/` and the four named feeds all render this; the path names the feed. */
const storyType = (pathname: string): StoryTypes => (pathname.split("/")[1] || "top") as StoryTypes;

// The feed routes take no params, so the open `RoutePreloadFuncArgs` is honest here.
export const preload = ({ location }: RoutePreloadFuncArgs) => {
  void getStories(storyType(location.pathname), Number(location.query.page) || 1);
};

export default function Stories(props: RouteSectionProps) {
  // `dynamic` over the query-wrapped server component is the whole client
  // surface. The source is tracked, so changing feed or page re-calls it and
  // the response morphs this boundary in place — no remount, no fallback
  // re-flash. `query` gives the call cache identity: a hover preload warms
  // the same entry this render reads.
  const View = dynamic(() =>
    getStories(storyType(props.location.pathname), Number(props.location.query.page) || 1)
  );
  return <View />;
}
