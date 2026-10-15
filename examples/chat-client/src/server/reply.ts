// The server function: a `"use server"` async generator. The browser calls
// it like a function and reads its yields as the model produces them.
//
// It forwards the request's signal to the model. When the browser cancels
// the call — Stop, or a new question superseding this one — the request is
// aborted, `request.signal` fires here, and the model stops. A reply nobody
// is reading costs nothing more. (A durable job, examples/chat's shape,
// deliberately does not forward it: there the reply outlives the request.)
//
// Called in-process — a server render, or the test — there is no request
// event and no signal; closing the iterator through `return()` is what
// stops the model then.
import { getRequestEvent } from "@solidjs/web";
import * as model from "./model";
import type { Turn } from "~/types";

export async function* reply(history: Turn[]): AsyncGenerator<string> {
  "use server";
  yield* model.stream(history, getRequestEvent()?.request.signal);
}
