// The data the client renders from. `query` wraps the server functions so the
// router can preload on link hover and dedupe the call the route component
// then makes — and so each result is serialized into the hydration payload.
//
// That payload is the point of this baseline: everything below arrives as
// JSON, the client renders every template from it, and the initial document
// therefore carries each story and comment twice — once as the HTML the
// server painted, once as the data that produced it.
import { query } from "@solidjs/router";
import * as hn from "./hn";

export const getStories = query(hn.getStories, "stories");
export const getStory = query(hn.getStory, "story");
export const getUser = query(hn.getUser, "user");
