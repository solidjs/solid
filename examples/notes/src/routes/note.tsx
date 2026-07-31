import type { RouteProps } from "@solidjs/router";
import { dynamic } from "@solidjs/web";
import { getNote } from "~/lib/api";

export default function Note(props: RouteProps<"/notes/:id">) {
  // The note view is pure server markup — even its Edit button is a plain
  // server-rendered anchor (the router intercepts anchor clicks), so there
  // are no client slots to fill here.
  const View = dynamic(() => getNote(+props.params.id));
  return <View />;
}
