// @solidjs/vite-plugin 3.0.0-next.35's default error boundary
// (`virtual:solid-ssr-error-boundary`), emitted into production builds
// unless `start.errorBoundary: false`; the generated entry wraps the
// document and the app in it.
import { Errored } from "solid-js";
import { httpStatus, isServer } from "@solidjs/web";

function ErrorFallback(props) {
  console.error(props.error());
  httpStatus(500);
  return (
    <span style="font-size:1.5em;text-align:center;position:fixed;left:0;bottom:55%;width:100%">
      {isServer ? "500 | Internal Server Error" : "Error | Uncaught Client Exception"}
    </span>
  );
}

export function DefaultErrorBoundary(props) {
  return <Errored fallback={error => <ErrorFallback error={error} />}>{props.children}</Errored>;
}
