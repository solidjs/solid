// The tables the attribute runtime consults (DOMWithState, ChildProperties,
// DelegatedEvents, Namespaces) live in attribute-tables.ts: this module is in
// every page's eager graph through $$SLOT / $$HOST, and those four must be
// free to follow `assign` into a lazy chunk.

// Per-node tag identifying the owning slot's marker. Set on every runtime
// insertion site so that subsequent reconcile / cleanup work can distinguish
// "the node still belongs to my slot" from "the node has migrated to another
// slot in the same parent" without consulting external bookkeeping.
const $$SLOT = /*#__PURE__*/ Symbol("slot");

// Guard companion to the `_$host` getter applied by `insert`'s `host` option:
// records which host accessor a node was last tagged with so unchanged nodes
// skip the `defineProperty` on subsequent updates.
const $$HOST = /*#__PURE__*/ Symbol("host");

// The delegated-event wire contract's handler key prefix: `node[EVENT_KEY +
// type]` is the delegated handler `addEvent` (client/attributes.ts) writes and
// the delegated dispatch in client.ts reads. The contract — and why the
// prefix is deliberately not v1's `$$` — is documented beside the dispatch.
const EVENT_KEY = "_$$";

const SVGElements = /*#__PURE__*/ new Set([
  // "a",
  "altGlyph",
  "altGlyphDef",
  "altGlyphItem",
  "animate",
  "animateColor",
  "animateMotion",
  "animateTransform",
  "circle",
  "clipPath",
  "color-profile",
  "cursor",
  "defs",
  "desc",
  "ellipse",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "filter",
  "font",
  "font-face",
  "font-face-format",
  "font-face-name",
  "font-face-src",
  "font-face-uri",
  "foreignObject",
  "g",
  "glyph",
  "glyphRef",
  "hkern",
  "image",
  "line",
  "linearGradient",
  "marker",
  "mask",
  "metadata",
  "missing-glyph",
  "mpath",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialGradient",
  "rect",
  // "script",
  "set",
  "stop",
  // "style",
  "svg",
  "switch",
  "symbol",
  "text",
  "textPath",
  // "title",
  "tref",
  "tspan",
  "use",
  "view",
  "vkern"
]);

const MathMLElements = /*#__PURE__*/ new Set([
  "annotation",
  "annotation-xml",
  "maction",
  "math",
  "menclose",
  "merror",
  "mfenced",
  "mfrac",
  "mi",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mprescripts",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "semantics"
]);

const VoidElements = /*#__PURE__*/ new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

const RawTextElements = /*#__PURE__*/ new Set([
  "style",
  "script",
  "noscript",
  "template",
  "textarea",
  "title"
]);

const DOMElements = /*#__PURE__*/ new Set(
  /*#__PURE__*/ "a,abbr,acronym,address,applet,area,article,aside,audio,b,base,basefont,bdi,bdo,bgsound,big,blink,blockquote,body,br,button,canvas,caption,center,cite,code,col,colgroup,content,data,datalist,dd,del,details,dfn,dialog,dir,div,dl,dt,em,embed,fieldset,figcaption,figure,font,footer,form,frame,frameset,h1,h2,h3,h4,h5,h6,head,header,hgroup,hr,html,i,iframe,image,img,input,ins,isindex,kbd,keygen,label,legend,li,link,listing,main,map,mark,marquee,math,menu,menuitem,meta,meter,multicol,nav,nextid,nobr,noembed,noframes,noindex,noscript,object,ol,optgroup,option,output,p,param,picture,plaintext,portal,pre,progress,q,rb,rp,rt,rtc,ruby,s,samp,script,search,section,select,shadow,slot,small,source,spacer,span,strike,strong,style,sub,summary,sup,svg,table,tbody,td,template,textarea,tfoot,th,thead,time,title,tr,track,tt,u,ul,var,video,wbr,webview,xmp".split(
    ","
  )
);

// Headers that describe a body the runtime replaces or composes itself.
const COMPOSED_BODY_FRAMING: ReadonlySet<string> = /*#__PURE__*/ new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding"
]);

// Scheme floor shared by server-function redirects and late streaming SSR.
function isHttpNavigationTarget(target: string): boolean {
  try {
    const protocol = new URL(target, "http://base.invalid").protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// Only `on` + an uppercase letter (`onClick`) is an event handler. Lowercase
// `on*` names (`onclick`) are plain attributes. No regex: this runs on every
// key of a spread, and a key not starting with `on` pays one `startsWith`.
function isEventName(name: string): boolean {
  let c;
  return name.startsWith("on") && (c = name.charCodeAt(2)) > 64 && c < 91;
}

export {
  SVGElements,
  MathMLElements,
  VoidElements,
  RawTextElements,
  DOMElements,
  $$SLOT,
  $$HOST,
  EVENT_KEY,
  COMPOSED_BODY_FRAMING,
  isHttpNavigationTarget,
  isEventName
};
