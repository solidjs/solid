import { serverRouteComponent, type RouteParams, type ServerRouteArgs } from "@solidjs/router";
import { respond } from "@solidjs/web";
import { GET } from "@solidjs/web/server-functions";
import { cacheable } from "~/server/cache";
import * as hn from "~/server/hn";

const getUser = GET(async ({ params }: ServerRouteArgs<RouteParams<"/users/:id">>) => {
  "use server";
  const user = await hn.getUser(params.id);
  return respond(
    () => (
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
    ),
    cacheable
  );
});

// No client half, so no route component to write: the router derives the
// call from the match, mounts its result, and makes the same call on link
// hover, so there is no `preload` either.
export default serverRouteComponent(getUser);
