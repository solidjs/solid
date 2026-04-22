import { hydrate } from "@solidjs/web";
import Shell from "../shared/src/components/Shell";
import App from "../shared/src/components/App";

hydrate(
  () => (
    <Shell>
      <App />
    </Shell>
  ),
  document
);
