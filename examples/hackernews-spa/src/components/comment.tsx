import { Component, For, Show } from "solid-js";
import { CommentDefinition } from "~/types";
import Toggle from "./toggle";

const Comment: Component<{ comment: CommentDefinition }> = props => {
  return (
    <li class="comment">
      <div class="by">
        <a href={`/users/${props.comment.user}`}>{props.comment.user}</a> {props.comment.time_ago}{" "}
        ago
      </div>
      <div class="text" innerHTML={props.comment.content} />
      <Show when={props.comment.comments.length}>
        <Toggle>
          <For each={props.comment.comments}>{comment => <Comment comment={comment} />}</For>
        </Toggle>
      </Show>
    </li>
  );
};

export default Comment;
