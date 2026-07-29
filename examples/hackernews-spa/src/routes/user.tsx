import { type RouteParams, type RoutePreloadFuncArgs, type RouteProps } from "@solidjs/router";
import { Show, createMemo } from "solid-js";
import { getUser } from "~/lib/api";

type Path = "/users/:id";

export const preload = ({ params }: RoutePreloadFuncArgs<RouteParams<Path>>) => {
  void getUser(params.id);
};

export default function User(props: RouteProps<Path>) {
  const user = createMemo(() => getUser(props.params.id));
  return (
    <div class="user-view">
      <h1>User : {user().id}</h1>
      <ul class="meta">
        <li>
          <span class="label">Created:</span> {user().created}
        </li>
        <li>
          <span class="label">Karma:</span> {user().karma}
        </li>
        <Show when={user().about}>
          <li innerHTML={user().about} class="about" />
        </Show>
      </ul>
      <p class="links">
        <a href={`https://news.ycombinator.com/submitted?id=${user().id}`}>submissions</a> |{" "}
        <a href={`https://news.ycombinator.com/threads?id=${user().id}`}>comments</a>
      </p>
    </div>
  );
}
