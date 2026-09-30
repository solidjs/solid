import {
  query,
  type RouteParams,
  type RoutePreloadFuncArgs,
  type RouteProps
} from "@solidjs/router";
import { dynamic } from "@solidjs/web";
import * as hn from "~/server/hn";

type Path = "/users/:id";

const getUser = query(async (id: string) => {
  "use server";
  const user = await hn.getUser(id);
  return () => (
    <div class="user-view">
      <h1>User : {user.id}</h1>
      <ul class="meta">
        <li>
          <span class="label">Created:</span> {user.created}
        </li>
        <li>
          <span class="label">Karma:</span> {user.karma}
        </li>
        {user.about ? <li innerHTML={user.about} class="about" /> : null}
      </ul>
      <p class="links">
        <a href={`https://news.ycombinator.com/submitted?id=${user.id}`}>submissions</a> |{" "}
        <a href={`https://news.ycombinator.com/threads?id=${user.id}`}>comments</a>
      </p>
    </div>
  );
}, "user");

export const preload = ({ params }: RoutePreloadFuncArgs<RouteParams<Path>>) => {
  void getUser(params.id);
};

export default function User(props: RouteProps<Path>) {
  const View = dynamic(() => getUser(props.params.id));
  return <View />;
}
