/**
 * Flags
 *
 * - 1 - Stateful property - value derives from reactive state
 * - 2 - Locked to property - value not specially treated
 */
const DOMWithState = {
  INPUT: { value: 1, defaultValue: 2, checked: 1, defaultChecked: 2 },
  SELECT: { value: 1 },
  OPTION: { value: 1, selected: 1, defaultSelected: 2 },
  TEXTAREA: { value: 1, defaultValue: 2 },
  VIDEO: { muted: 1, defaultMuted: 2 },
  AUDIO: { muted: 1, defaultMuted: 2 }
};

const ChildProperties = /*#__PURE__*/ new Set([
  "innerHTML",
  "textContent",
  "innerText",
  "children"
]);

// Per-node tag identifying the owning slot's marker. Set on every runtime
// insertion site so that subsequent reconcile / cleanup work can distinguish
// "the node still belongs to my slot" from "the node has migrated to another
// slot in the same parent" without consulting external bookkeeping.
const $$SLOT = /*#__PURE__*/ Symbol("slot");

// Guard companion to the `_$host` getter applied by `insert`'s `host` option:
// records which host accessor a node was last tagged with so unchanged nodes
// skip the `defineProperty` on subsequent updates.
const $$HOST = /*#__PURE__*/ Symbol("host");

// list of Element events that will be delegated
const DelegatedEvents = /*#__PURE__*/ new Set([
  "beforeinput",
  "click",
  "dblclick",
  "contextmenu",
  "focusin",
  "focusout",
  "input",
  "keydown",
  "keyup",
  "mousedown",
  "mousemove",
  "mouseout",
  "mouseover",
  "mouseup",
  "pointerdown",
  "pointermove",
  "pointerout",
  "pointerover",
  "pointerup",
  "touchend",
  "touchmove",
  "touchstart"
]);

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

const Namespaces = {
  svg: "http://www.w3.org/2000/svg",
  mathml: "http://www.w3.org/1998/Math/MathML",
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace"
};

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

export {
  DOMWithState,
  ChildProperties,
  DelegatedEvents,
  SVGElements,
  MathMLElements,
  VoidElements,
  RawTextElements,
  Namespaces,
  DOMElements,
  $$SLOT,
  $$HOST
};
