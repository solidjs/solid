import { afterAll, bench } from "vitest";
import { createEffect, createRoot, createStore, deep, flush, reconcile } from "../../src/index.js";

// Tier-1 store-lane bench. Listened-paths category — the Solid 2.0
// `applyState` walks `Object.keys(nodes)` (keys with subscribers)
// instead of `Object.keys(next)` (every key in the new value), so
// `setStore(reconcile(...))` cost should scale with the number of
// *listened* paths rather than the size of the incoming tree.
//
// This is the unique-to-Solid-2.0 store optimization. It is invisible
// in JFB and UIBench because both subscribe to every field per row,
// so every key is "listened" and the optimization can't show up.
// The three benches below subject the same deeply-nested tree to the
// same per-iteration replacement payload, varying only the subscription
// shape:
//
//   1. sparse — 10 explicit deep-leaf effects. Listened-paths' best
//      case: cost should be near-flat regardless of tree size.
//   2. saturated — every leaf has its own effect. Worst case: full
//      tree walk by definition.
//   3. deep() — single effect using the `deep()` helper, which
//      subscribes one consumer to every nested store node's `$TRACK`
//      signal. A real production idiom (sync engines, worker bridges,
//      `JSON.stringify` reactivity) — distinct cost shape from per-leaf
//      subscription because each store node has 1 subscriber instead
//      of multiple per-leaf ones.
//
// The sparse vs saturated ratio is the visibility of the listened-paths
// optimization. If anyone regresses `applyState` to walk
// `Object.keys(next)` again, sparse collapses to saturated's cost —
// instant alarm. The `deep()` bench separately tracks the
// whole-tree-listener path that real apps actually use.
//
// Tree shape (per buildState iteration):
//   { documents: [
//       { id, meta: { author, timestamp, tags: [t0, t1, t2] },
//         content: {
//           title, body,
//           sections: [
//             { heading, text,
//               comments: [
//                 { author, body }, ... (3 comments)
//               ]
//             }, ... (10 sections)
//           ]
//         }
//       }, ... (100 documents)
//     ] }
// Roughly 12,000 string leaves nested 4–6 levels deep.

const DOCS = 100;
const SECTIONS = 10;
const COMMENTS = 3;
const TAGS = 3;

interface Comment {
  author: string;
  body: string;
}
interface Section {
  heading: string;
  text: string;
  comments: Comment[];
}
interface Document {
  id: number;
  meta: { author: string; timestamp: number; tags: string[] };
  content: { title: string; body: string; sections: Section[] };
}
interface State {
  documents: Document[];
}

function buildState(seed: number): State {
  const documents = new Array<Document>(DOCS);
  for (let i = 0; i < DOCS; i++) {
    const tags = new Array<string>(TAGS);
    for (let t = 0; t < TAGS; t++) tags[t] = `tag-${i}-${t}-${seed}`;
    const sections = new Array<Section>(SECTIONS);
    for (let s = 0; s < SECTIONS; s++) {
      const comments = new Array<Comment>(COMMENTS);
      for (let c = 0; c < COMMENTS; c++) {
        comments[c] = {
          author: `cauthor-${i}-${s}-${c}-${seed}`,
          body: `cbody-${i}-${s}-${c}-${seed}`
        };
      }
      sections[s] = {
        heading: `h-${i}-${s}-${seed}`,
        text: `t-${i}-${s}-${seed}`,
        comments
      };
    }
    documents[i] = {
      id: i,
      meta: {
        author: `author-${i}-${seed}`,
        timestamp: seed * 1000 + i,
        tags
      },
      content: {
        title: `title-${i}-${seed}`,
        body: `body-${i}-${seed}`,
        sections
      }
    };
  }
  return { documents };
}

const cleanups: Array<() => void> = [];
afterAll(() => {
  for (const dispose of cleanups) dispose();
});

// All three benches use a SINGLE sink effect so per-effect scheduling
// overhead is identical across modes. Only the *shape* of the tracking
// tree differs, isolating `applyState`'s walk cost. Each effect reads
// from `state` down so the tracking path is connected end-to-end —
// otherwise root-level `nodes` is empty and applyState bails before
// reaching anything (the bug in the previous pass of this bench).

// ---------------------------------------------------------------------------
// Sparse: one effect reading 10 deep paths. With listened-paths active,
// `applyState` walks just those 10 path prefixes, not the full tree.
// ---------------------------------------------------------------------------

let sparseSet!: (v: any) => void;
{
  const dispose = createRoot(d => {
    const [state, setState] = createStore(buildState(0));
    sparseSet = (v: any) => setState(reconcile(v, "id"));
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

let sparseSeed = 1;
bench("reconcile: deep tree, 10 of ~12k paths subscribed", () => {
  sparseSet(buildState(sparseSeed++));
  flush();
});

// ---------------------------------------------------------------------------
// Saturated (per-leaf): one effect that walks from `state` down and reads
// every leaf. Tracking populates `nodes` at every level for every key,
// forcing applyState to walk the full tree. Walks via `Object.keys(nodes)`
// (no `$TRACK` involvement), so this is the worst case for the listened-
// paths optimization itself.
// ---------------------------------------------------------------------------

let saturatedSet!: (v: any) => void;
{
  const dispose = createRoot(d => {
    const [state, setState] = createStore(buildState(0));
    saturatedSet = (v: any) => setState(reconcile(v, "id"));
    createEffect(
      () => {
        const docs = state.documents;
        for (let i = 0; i < DOCS; i++) {
          const doc = docs[i]!;
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
            const sec = sections[s]!;
            void sec.heading;
            void sec.text;
            const comments = sec.comments;
            for (let c = 0; c < COMMENTS; c++) {
              const cmt = comments[c]!;
              void cmt.author;
              void cmt.body;
            }
          }
        }
      },
      () => {}
    );
    return d;
  });
  cleanups.push(dispose);
  flush();
}

let saturatedSeed = 1;
bench("reconcile: deep tree, all ~12k paths subscribed", () => {
  saturatedSet(buildState(saturatedSeed++));
  flush();
});

// ---------------------------------------------------------------------------
// Deep: one effect calling the `deep()` helper. Same coverage as saturated
// but subscribes via every node's `$TRACK` signal. `applyState` then
// switches to `getAllKeys(previous, undefined, next)` instead of
// `Object.keys(nodes)`, walking every key whether subscribed or not.
// Production idiom (sync engines, worker bridges, JSON observers).
// ---------------------------------------------------------------------------

let deepSet!: (v: any) => void;
{
  const dispose = createRoot(d => {
    const [state, setState] = createStore(buildState(0));
    deepSet = (v: any) => setState(reconcile(v, "id"));
    createEffect(
      () => deep(state),
      () => {}
    );
    return d;
  });
  cleanups.push(dispose);
  flush();
}

let deepSeed = 1;
bench("reconcile: deep tree, single deep() effect", () => {
  deepSet(buildState(deepSeed++));
  flush();
});
