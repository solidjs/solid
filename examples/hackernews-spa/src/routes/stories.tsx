import { query, type RoutePreloadFuncArgs, type RouteSectionProps } from "@solidjs/router";
import { For, Show, createMemo } from "solid-js";
import Story from "~/components/story";
import * as hn from "~/server/hn";
import type { StoryTypes } from "~/types";

const getStories = query(async (type: StoryTypes, page: number) => {
  "use server";
  return hn.getStories(type, page);
}, "stories");

/** `/` and the four named feeds all render this; the path names the feed. */
const storyType = (pathname: string): StoryTypes => (pathname.split("/")[1] || "top") as StoryTypes;

// The feed routes take no params, so the open `RouteSectionProps` is honest here.
export const preload = ({ location }: RoutePreloadFuncArgs) => {
  void getStories(storyType(location.pathname), Number(location.query.page) || 1);
};

export default function Stories(props: RouteSectionProps) {
  const page = () => Number(props.location.query.page) || 1;
  const type = () => storyType(props.location.pathname);
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
