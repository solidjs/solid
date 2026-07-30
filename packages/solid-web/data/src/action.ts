/**
 * `action()` — form-bindable mutations, after @solidjs/router's `action()`.
 *
 * Server function references carry a stable `.url`, so `toString()` renders
 * the real endpoint into `<form action={...}>` — without JS the browser POSTs
 * there natively (the transport handles no-JS form posts). With JS, a single
 * document-level submit listener intercepts matching forms and calls the RPC
 * stub instead; non-GET calls opt into single-flight automatically while a
 * flight-data consumer is subscribed, so post-mutation query data rides back
 * on the response (see ./flight.ts).
 *
 * The function receives the form's FormData when it declares a parameter.
 * TODO: submission state (useSubmission) and redirect handling.
 */
import { isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { isServerFunction } from "@solidjs/web/server-functions";

export type Action<A extends any[], R> = ((...args: A) => Promise<R>) &
  JSX.SerializableAttributeValue & { url: string };

const actions = new Map<string, (formData: FormData) => Promise<unknown>>();

if (!isServer) {
  document.addEventListener("submit", event => {
    const form = event.target as HTMLFormElement;
    const submitter = event.submitter;
    const url = submitter?.getAttribute("formaction")
      ? (submitter as HTMLButtonElement).formAction
      : form.action;
    const handler = actions.get(url);
    if (!handler) return;
    event.preventDefault();
    void handler(new FormData(form, submitter));
  });
}

export function action<A extends any[], R>(fn: (...args: A) => Promise<R>): Action<A, R> {
  if (!isServerFunction(fn)) throw new Error("action() expects a server function");
  const wrapper = ((...args: A) => fn(...args)) as Action<A, R>;
  wrapper.url = fn.url;
  wrapper.toString = () => fn.url;
  // key by resolved URL — form.action reads back absolute
  if (!isServer)
    actions.set(new URL(fn.url, window.location.href).href, formData =>
      fn.length > 0 ? fn(...([formData] as unknown as A)) : (fn as () => Promise<R>)()
    );
  return wrapper;
}
