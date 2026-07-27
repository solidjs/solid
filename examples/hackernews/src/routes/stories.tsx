import { type RouteSectionProps } from "@solidjs/router";
import { dynamic } from "@solidjs/web";
import { storiesView } from "~/lib/views";
import type { StoryTypes } from "~/types";

/** `/` and the four named feeds all render this; the path names the feed. */
export const storyType = (pathname: string): StoryTypes =>
  (pathname.split("/")[1] || "top") as StoryTypes;

export default function Stories(props: RouteSectionProps) {
  // `dynamic` over a server-function call is the whole client surface. The
  // source is tracked, so changing feed or page re-calls it and the response
  // morphs this boundary in place — no remount, no fallback re-flash.
  const View = dynamic(() =>
    storiesView(storyType(props.location.pathname), +props.location.query.page || 1)
  );
  return <View />;
}
