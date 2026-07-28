import { type RouteSectionProps } from "@solidjs/router";
import { dynamic } from "@solidjs/web";
import Toggle from "~/components/toggle";
import { storyView } from "~/lib/views";

export default function Story(props: RouteSectionProps) {
  const View = dynamic(() => storyView(props.params.id!));
  // The one client-owned piece of a thread: the server fills this slot per
  // comment that has replies, and the replies themselves arrive as server
  // markup inside the Toggle's list. Collapse state is client state — it never
  // appears in a request.
  return <View toggle={p => <Toggle>{p.children}</Toggle>} />;
}
