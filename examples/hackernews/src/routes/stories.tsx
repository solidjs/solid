import { type RoutePreloadFuncArgs, type RouteSectionProps } from "@solidjs/router";
import { dynamic } from "@solidjs/web";
import { getStories } from "~/lib/api";
import type { StoryTypes } from "~/types";

/** `/` and the four named feeds all render this; the path names the feed. */
export const storyType = (pathname: string): StoryTypes =>
  (pathname.split("/")[1] || "top") as StoryTypes;

// The feed routes take no params, so the open `RoutePreloadFuncArgs` is honest here.
export const preload = ({ location }: RoutePreloadFuncArgs) => {
  void getStories(storyType(location.pathname), Number(location.query.page) || 1);
};

export default function Stories(props: RouteSectionProps) {
  // `dynamic` over the query-wrapped server component is the whole client
  // surface. The source is tracked, so changing feed or page re-calls it and
  // the response morphs this boundary in place — no remount, no fallback
  // re-flash. `query` gives the call cache identity: a hover preload warms
  // the same entry this render reads.
  const View = dynamic(() =>
    getStories(storyType(props.location.pathname), Number(props.location.query.page) || 1)
  );
  return <View />;
}
