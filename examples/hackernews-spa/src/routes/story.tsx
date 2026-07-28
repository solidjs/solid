import { type RouteSectionProps } from "@solidjs/router";
import { For, Show, createMemo } from "solid-js";
import Comment from "~/components/comment";
import { getStory } from "~/lib/api";

export const preload = ({ params }: { params: RouteSectionProps["params"] }) => {
  void getStory(params.id!);
};

export default function Story(props: RouteSectionProps) {
  const story = createMemo(() => getStory(props.params.id!));
  return (
    <div class="item-view">
      <div class="item-view-header">
        <a href={story().url} target="_blank">
          <h1>{story().title}</h1>
        </a>
        <Show when={story().domain}>
          <span class="host">({story().domain})</span>
        </Show>
        <p class="meta">
          {story().points} points | by <a href={`/users/${story().user}`}>{story().user}</a>{" "}
          {story().time_ago} ago
        </p>
      </div>
      <div class="item-view-comments">
        <p class="item-view-comments-header">
          {story().comments_count ? story().comments_count + " comments" : "No comments yet."}
        </p>
        <ul class="comment-children">
          <For each={story().comments}>{comment => <Comment comment={comment} />}</For>
        </ul>
      </div>
    </div>
  );
}
