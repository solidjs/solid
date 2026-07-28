import { type RouteSectionProps } from "@solidjs/router";
import { For, Show, createMemo } from "solid-js";
import Story from "~/components/story";
import { getStories } from "~/lib/api";
import type { StoryTypes } from "~/types";

/** `/` and the four named feeds all render this; the path names the feed. */
export const storyType = (pathname: string): StoryTypes =>
  (pathname.split("/")[1] || "top") as StoryTypes;

export const preload = ({ location }: { location: RouteSectionProps["location"] }) => {
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
