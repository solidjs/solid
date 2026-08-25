// Tier-1 store-lane bench. Pruning-contract category — guards the #2902
// descent gate.
//
// Shape: the whole tree is read ONCE untracked (event-handler / validation
// idiom), so a wrapped proxy exists for every record, but only 10 deep
// paths are subscribed. reconcile's object diff must keep walking just the
// observed spines: proxies alone (no nodes anywhere below) must NOT enroll
// a subtree in the diff. When the #2902 gate was evaluated, an alternative
// proxy-existence gate measured 5-7x slower on exactly this shape (every
// proxied record re-enrolls in every future diff, permanently); the
// STORE_DESC node-presence gate keeps it within noise of the never-read
// sparse case. If this bench collapses toward the saturated case in
// `listened-paths.bench.ts`, the pruning contract broke.
import { afterAll, bench } from "vitest";
import {
  createEffect,
  createRoot,
  createStore,
  flush,
  reconcile,
  untrack
} from "../../src/index.js";

const DOCS = 100;
const SECTIONS = 10;
const COMMENTS = 3;
const TAGS = 3;

function buildState(seed: number) {
  const documents = new Array(DOCS);
  for (let i = 0; i < DOCS; i++) {
    const tags = new Array(TAGS);
    for (let t = 0; t < TAGS; t++) tags[t] = `tag-${i}-${t}-${seed}`;
    const sections = new Array(SECTIONS);
    for (let s = 0; s < SECTIONS; s++) {
      const comments = new Array(COMMENTS);
      for (let c = 0; c < COMMENTS; c++) {
        comments[c] = {
          author: `cauthor-${i}-${s}-${c}-${seed}`,
          body: `cbody-${i}-${s}-${c}-${seed}`
        };
      }
      sections[s] = { heading: `h-${i}-${s}-${seed}`, text: `t-${i}-${s}-${seed}`, comments };
    }
    documents[i] = {
      id: i,
      meta: { author: `author-${i}-${seed}`, timestamp: seed * 1000 + i, tags },
      content: { title: `title-${i}-${seed}`, body: `body-${i}-${seed}`, sections }
    };
  }
  return { documents };
}

// Full walk that reads every leaf — used UNTRACKED to materialize proxies
// for every record without creating a single node.
function walk(state: any) {
  const docs = state.documents;
  for (let i = 0; i < DOCS; i++) {
    const doc = docs[i];
    void doc.id;
    void doc.meta.author;
    void doc.meta.timestamp;
    const tags = doc.meta.tags;
    for (let t = 0; t < TAGS; t++) void tags[t];
    const content = doc.content;
    void content.title;
    void content.body;
    const sections = content.sections;
    for (let s = 0; s < SECTIONS; s++) {
      const sec = sections[s];
      void sec.heading;
      void sec.text;
      const comments = sec.comments;
      for (let c = 0; c < COMMENTS; c++) {
        const cmt = comments[c];
        void cmt.author;
        void cmt.body;
      }
    }
  }
}

const cleanups: Array<() => void> = [];
afterAll(() => {
  for (const dispose of cleanups) dispose();
});

let set!: (v: any) => void;
{
  const dispose = createRoot(d => {
    const [state, setState] = createStore(buildState(0));
    set = (v: any) => setState(reconcile(v, "id"));
    // One untracked full read: proxies everywhere, nodes nowhere.
    untrack(() => walk(state));
    createEffect(
      () => {
        void state.documents[3]!.meta.author;
        void state.documents[17]!.content.title;
        void state.documents[42]!.content.sections[5]!.text;
        void state.documents[42]!.content.sections[5]!.comments[1]!.body;
        void state.documents[64]!.content.sections[2]!.heading;
        void state.documents[80]!.meta.tags[1];
        void state.documents[91]!.content.sections[7]!.comments[2]!.author;
        void state.documents[12]!.content.body;
        void state.documents[55]!.content.sections[9]!.text;
        void state.documents[99]!.content.sections[0]!.comments[0]!.body;
      },
      () => {}
    );
    return d;
  });
  cleanups.push(dispose);
  flush();
}

let seed = 1;
bench("reconcile: read-once untracked tree, 10 of ~12k paths subscribed", () => {
  set(buildState(seed++));
  flush();
});
