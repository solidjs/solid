import {
  query,
  type RouteParams,
  type RoutePreloadFuncArgs,
  type RouteProps
} from "@solidjs/router";
import { createSignal } from "solid-js";
import { dynamic } from "@solidjs/web";
import type { BindingSlot } from "@solidjs/web/frames";
import * as hn from "~/server/hn";
import type { CommentDefinition } from "~/types";

// The pattern witness types `params.id` as `string` — this component is
// declared away from its route, so it names the pattern it belongs to.
type Path = "/stories/:id";

/** What the client decides about one comment's replies. */
interface Toggle {
  open: boolean;
  label: string;
  display: "block" | "none";
  onToggle: () => void;
}
type ToggleSlot = BindingSlot<{}, Toggle>;

const getStory = query(async (id: string) => {
  "use server";
  const story = await hn.getStory(id);
  return (props: { toggle: ToggleSlot }) => (
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
            <Comment comment={comment} toggle={props.toggle} />
          ))}
        </ul>
      </div>
    </div>
  );
}, "story");

/**
 * Recursive, and entirely server markup: the client never sees the tree,
 * only one toggle per comment that has replies.
 */
function Comment(props: { comment: CommentDefinition; toggle: ToggleSlot }) {
  const c = props.comment;
  const t = c.comments.length ? props.toggle({ $key: c.id }) : null;
  return (
    <li class="comment">
      <div class="by">
        <a href={`/users/${c.user}`}>{c.user}</a> {c.time_ago} ago
      </div>
      <div class="text" innerHTML={c.content} />
      {t ? (
        <>
          <div class={["toggle", { open: t.open }]}>
            <a onClick={t.onToggle}>{t.label}</a>
          </div>
          <ul class="comment-children" style={{ display: t.display }}>
            {c.comments.map(reply => (
              <Comment comment={reply} toggle={props.toggle} />
            ))}
          </ul>
        </>
      ) : null}
    </li>
  );
}

export const preload = ({ params }: RoutePreloadFuncArgs<RouteParams<Path>>) => {
  void getStory(params.id);
};

export default function Story(props: RouteProps<Path>) {
  const View = dynamic(() => getStory(props.params.id));
  return (
    <View
      toggle={() => {
        const [open, setOpen] = createSignal(true);
        return {
          get open() {
            return open();
          },
          get label() {
            return open() ? "[-]" : "[+] comments collapsed";
          },
          get display() {
            return open() ? "block" : "none";
          },
          onToggle: () => setOpen(o => !o)
        };
      }}
    />
  );
}
