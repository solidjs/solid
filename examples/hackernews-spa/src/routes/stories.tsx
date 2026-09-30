import {
  query,
  type RouteParams,
  type RoutePreloadFuncArgs,
  type RouteProps,
  type SearchParams
} from "@solidjs/router";
import { For, Show, createMemo } from "solid-js";
import Story from "~/components/story";
import * as hn from "~/server/hn";
import type { StoryTypes } from "~/types";

// The route lives in app.tsx, so the component and preload here name the
// pattern they belong to.
type Path = "/:type?";

const getStories = query(async (type: StoryTypes, page: number) => {
  "use server";
  return hn.getStories(type, page);
}, "stories");

/** `/` is the top feed; the route's filter admits only the five feed names. */
const storyType = (params: RouteParams<Path>) => (params.type || "top") as StoryTypes;
const pageOf = (query: SearchParams) => Number(query.page) || 1;

export const preload = ({ params, location }: RoutePreloadFuncArgs<RouteParams<Path>>) => {
  void getStories(storyType(params), pageOf(location.query));
};

export default function Stories(props: RouteProps<Path>) {
  const page = () => pageOf(props.location.query);
  const type = () => storyType(props.params);
  const stories = createMemo(() => getStories(type(), page()));

  return (
    <div class="news-view">
      <div class="news-list-nav">
        <Show
          when={page() > 1}
          fallback={
            <span class="page-link disabled" aria-disabled="true">
              {"<"} prev
            </span>
          }
        >
          <a class="page-link" href={`/${type()}?page=${page() - 1}`} aria-label="Previous Page">
            {"<"} prev
          </a>
        </Show>
        <span>page {page()}</span>
        <Show
          when={stories() && stories()!.length >= 29}
          fallback={
            <span class="page-link disabled" aria-disabled="true">
              more {">"}
            </span>
          }
        >
          <a class="page-link" href={`/${type()}?page=${page() + 1}`} aria-label="Next Page">
            more {">"}
          </a>
        </Show>
      </div>
      <main class="news-list">
        <For each={stories()}>{story => <Story story={story} />}</For>
      </main>
    </div>
  );
}
