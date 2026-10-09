import { Component, For, Show } from "solid-js";
import { CommentDefinition } from "~/types";

const Comment: Component<{ comment: CommentDefinition }> = props => {
  return (
    <li class="comment">
      <div class="by">
        <a href={`/users/${props.comment.user}`}>{props.comment.user}</a> {props.comment.time_ago}{" "}
        ago
      </div>
      <div class="text" innerHTML={props.comment.content} />
      <Show when={props.comment.comments.length}>
        <details class="toggle" open>
          <summary>
            <span class="open-label">[-]</span>
            <span class="closed-label">[+] comments collapsed</span>
          </summary>
          <ul class="comment-children">
            <For each={props.comment.comments}>{comment => <Comment comment={comment} />}</For>
          </ul>
        </details>
      </Show>
    </li>
  );
};

export default Comment;
