// Shared head-management logic (see docs/head-management-rfc.md).
//
// Environment-agnostic: identity computation, tag classification, and the
// last-committed-group resolution model, imported by both `server.js` and
// `client.js`. Everything with an environment (markup rendering, patch
// emission, DOM apply, ownership) lives in the respective entry.

export const HEAD_ELIGIBLE_TAGS = new Set(["title", "meta", "link", "style", "script", "base"]);

// Attribute names ride markup, patch payloads, and setAttribute calls
// verbatim; anything a user could sneak markup or invalid names through is
// rejected instead of escaped.
export const HEAD_ATTR_NAME = /^[a-zA-Z_][a-zA-Z0-9_:.-]*$/;

// link rels whose value is earliness rather than "which one wins" — the
// resource class. Identity-deduped by URL + qualifying attributes, emitted
// eagerly, never replaced or retracted (except stylesheets, whose removal is
// visible and follows the owner on the client). Icons are deliberately NOT
// here: an icon's value is which one wins (favicon swapping is a real
// pattern), so they are replaceable.
export const RESOURCE_LINK_RELS = new Set([
  "preload",
  "modulepreload",
  "prefetch",
  "preconnect",
  "dns-prefetch",
  "stylesheet"
]);

// Attributes that qualify a resource identity: the same href preloaded
// `as="image"` and `as="fetch"` are different requests, and crossorigin
// changes cacheability. URL alone is not the identity.
const RESOURCE_QUALIFIERS = ["as", "crossorigin", "type", "media", "imagesrcset", "imagesizes"];

// Stylesheet attributes that are pure fetch metadata: they change how the
// sheet is fetched, not whether it applies. A stylesheet whose extra
// attributes all come from this set is exactly as render-critical as a plain
// one and participates in boundary reveal gating. Condition-changing
// attributes (media, title/alternate, disabled) exclude a sheet from gating —
// holding a reveal on a sheet that may never apply would block content on a
// low-priority fetch.
export const STYLESHEET_FETCH_META = new Set([
  "crossorigin",
  "integrity",
  "referrerpolicy",
  "fetchpriority"
]);

export function evalHeadValue(v) {
  return typeof v === "function" ? v() : v;
}

// Evaluates a props record: getter values are called once. `presets` carries
// values already evaluated earlier (a link's `rel`, peeked at registration to
// classify), so their getters are not called a second time. `key` is not a
// prop and is handled by the caller; `children` is the text body.
export function evalHeadProps(props, presets) {
  const out = {};
  for (const name in props)
    out[name] = presets && name in presets ? presets[name] : evalHeadValue(props[name]);
  return out;
}

// Classifies a raw (unevaluated) tag descriptor. Only `rel` needs its value
// to classify a link — it is read (and a getter called) at registration
// time; the peeked value is reused so getters still run at most once.
// `style`/`script` classify on prop *presence* (href/src), which never
// forces evaluation.
export function classifyHeadTag(desc) {
  const tag = desc.tag;
  if (tag === "link") {
    const rel = evalHeadValue(desc.props && desc.props.rel);
    return { resource: RESOURCE_LINK_RELS.has(rel), rel };
  }
  if (tag === "style") return { resource: !!(desc.props && "href" in desc.props) };
  if (tag === "script") return { resource: !!(desc.props && "src" in desc.props) };
  return { resource: false };
}

// Identity for a resource-class tag (evaluated props).
export function resourceIdentity(tag, props) {
  let id = "res:" + tag + ":" + (props.rel || "") + ":" + (props.href || props.src || "");
  for (let i = 0; i < RESOURCE_QUALIFIERS.length; i++) {
    const q = RESOURCE_QUALIFIERS[i];
    if (props[q] != null) id += ":" + q + "=" + props[q];
  }
  return id;
}

// Identity for a replaceable tag (evaluated props). `unique` supplies a
// stable per-registration fallback for tags with no natural identity
// (inline style/script without an explicit key). Returns the identity
// string; `title` is a hard singleton (`key` cannot fork it) and
// `base`/`meta[charset]` are shell-only singletons.
export function replaceableIdentity(tag, props, key, unique) {
  if (tag === "title") return "title";
  if (tag === "base") return "base";
  if (tag === "meta" && props.charset != null) return "charset";
  if (key != null) return tag + ":key:" + key;
  if (tag === "meta") {
    // `media` qualifies identity: multiple metas differing by media query
    // (e.g. theme-color light/dark) are spec-blessed and must coexist —
    // consistent with `media` qualifying resource identities.
    for (const ns of ["name", "property", "http-equiv"])
      if (props[ns] != null)
        return (
          "meta:" + ns + ":" + props[ns] + (props.media != null ? ":media=" + props.media : "")
        );
    return unique;
  }
  if (tag === "link") {
    const rel = props.rel || "";
    // Icons are replaceable with an identity that EXCLUDES href — a swapped
    // icon replaces its predecessor (favicon swapping) — while `sizes`/`type`
    // variants (ico + svg + apple-touch sizes) coexist as separate identities.
    if (rel === "icon" || rel === "apple-touch-icon")
      return (
        "link:" +
        rel +
        (props.sizes != null ? ":sizes=" + props.sizes : "") +
        (props.type != null ? ":type=" + props.type : "")
      );
    return "link:" + rel + ":" + (props.href || "");
  }
  return unique; // inline style/script without a key: append-only
}

// Last-committed-group resolution. `groups` is an array of
// `{ seq, tags: [{ tag, props, identity }] }` — evaluated tags with
// identities attached. Returns `Map<identity, { seq, tags }>` where `tags`
// is the winning group's full set for that identity (set replacement: a
// later group's tags for an identity replace the earlier group's set
// wholesale). Iteration order of the map is not meaningful; callers order
// output themselves.
export function resolveHead(groups) {
  const winners = new Map();
  const sorted = groups.slice().sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < sorted.length; i++) {
    const group = sorted[i];
    const byIdentity = new Map();
    for (let j = 0; j < group.tags.length; j++) {
      const t = group.tags[j];
      let list = byIdentity.get(t.identity);
      if (!list) byIdentity.set(t.identity, (list = []));
      list.push(t);
    }
    for (const [identity, tags] of byIdentity) {
      if (identity === "title") {
        if ("_DX_DEV_" && tags.length > 1)
          console.warn("Multiple <title> tags in one head group; the last one wins.");
        winners.set(identity, { seq: group.seq, tags: [tags[tags.length - 1]] });
      } else {
        winners.set(identity, { seq: group.seq, tags });
      }
    }
  }
  return winners;
}
