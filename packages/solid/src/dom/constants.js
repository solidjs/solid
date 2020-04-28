const Types = {
    ATTRIBUTE: "attribute",
    PROPERTY: "property"
  },
  Attributes = {
    href: {
      type: Types.ATTRIBUTE
    },
    style: {
      type: Types.PROPERTY,
      alias: "style.cssText"
    },
    for: {
      type: Types.PROPERTY,
      alias: "htmlFor"
    },
    class: {
      type: Types.PROPERTY,
      alias: "className"
    },
    // React compat
    spellCheck: {
      type: Types.PROPERTY,
      alias: "spellcheck"
    },
    allowFullScreen: {
      type: Types.PROPERTY,
      alias: "allowFullscreen"
    },
    autoCapitalize: {
      type: Types.PROPERTY,
      alias: "autocapitalize"
    },
    autoFocus: {
      type: Types.PROPERTY,
      alias: "autofocus"
    },
    autoPlay: {
      type: Types.PROPERTY,
      alias: "autoplay"
    }
  },
  SVGAttributes = {
    className: {
      type: Types.ATTRIBUTE,
      alias: "class"
    },
    htmlFor: {
      type: Types.ATTRIBUTE,
      alias: "for"
    },
    tabIndex: {
      type: Types.ATTRIBUTE,
      alias: "tabindex"
    },
    allowReorder: {
      type: Types.ATTRIBUTE
    },
    attributeName: {
      type: Types.ATTRIBUTE
    },
    attributeType: {
      type: Types.ATTRIBUTE
    },
    autoReverse: {
      type: Types.ATTRIBUTE
    },
    baseFrequency: {
      type: Types.ATTRIBUTE
    },
    calcMode: {
      type: Types.ATTRIBUTE
    },
    clipPathUnits: {
      type: Types.ATTRIBUTE
    },
    contentScriptType: {
      type: Types.ATTRIBUTE
    },
    contentStyleType: {
      type: Types.ATTRIBUTE
    },
    diffuseConstant: {
      type: Types.ATTRIBUTE
    },
    edgeMode: {
      type: Types.ATTRIBUTE
    },
    externalResourcesRequired: {
      type: Types.ATTRIBUTE
    },
    filterRes: {
      type: Types.ATTRIBUTE
    },
    filterUnits: {
      type: Types.ATTRIBUTE
    },
    gradientTransform: {
      type: Types.ATTRIBUTE
    },
    gradientUnits: {
      type: Types.ATTRIBUTE
    },
    kernelMatrix: {
      type: Types.ATTRIBUTE
    },
    kernelUnitLength: {
      type: Types.ATTRIBUTE
    },
    keyPoints: {
      type: Types.ATTRIBUTE
    },
    keySplines: {
      type: Types.ATTRIBUTE
    },
    keyTimes: {
      type: Types.ATTRIBUTE
    },
    lengthAdjust: {
      type: Types.ATTRIBUTE
    },
    limitingConeAngle: {
      type: Types.ATTRIBUTE
    },
    markerHeight: {
      type: Types.ATTRIBUTE
    },
    markerUnits: {
      type: Types.ATTRIBUTE
    },
    maskContentUnits: {
      type: Types.ATTRIBUTE
    },
    maskUnits: {
      type: Types.ATTRIBUTE
    },
    numOctaves: {
      type: Types.ATTRIBUTE
    },
    pathLength: {
      type: Types.ATTRIBUTE
    },
    patternContentUnits: {
      type: Types.ATTRIBUTE
    },
    patternTransform: {
      type: Types.ATTRIBUTE
    },
    patternUnits: {
      type: Types.ATTRIBUTE
    },
    pointsAtX: {
      type: Types.ATTRIBUTE
    },
    pointsAtY: {
      type: Types.ATTRIBUTE
    },
    pointsAtZ: {
      type: Types.ATTRIBUTE
    },
    preserveAlpha: {
      type: Types.ATTRIBUTE
    },
    preserveAspectRatio: {
      type: Types.ATTRIBUTE
    },
    primitiveUnits: {
      type: Types.ATTRIBUTE
    },
    refX: {
      type: Types.ATTRIBUTE
    },
    refY: {
      type: Types.ATTRIBUTE
    },
    repeatCount: {
      type: Types.ATTRIBUTE
    },
    repeatDur: {
      type: Types.ATTRIBUTE
    },
    requiredExtensions: {
      type: Types.ATTRIBUTE
    },
    requiredFeatures: {
      type: Types.ATTRIBUTE
    },
    specularConstant: {
      type: Types.ATTRIBUTE
    },
    specularExponent: {
      type: Types.ATTRIBUTE
    },
    spreadMethod: {
      type: Types.ATTRIBUTE
    },
    startOffset: {
      type: Types.ATTRIBUTE
    },
    stdDeviation: {
      type: Types.ATTRIBUTE
    },
    stitchTiles: {
      type: Types.ATTRIBUTE
    },
    surfaceScale: {
      type: Types.ATTRIBUTE
    },
    systemLanguage: {
      type: Types.ATTRIBUTE
    },
    tableValues: {
      type: Types.ATTRIBUTE
    },
    targetX: {
      type: Types.ATTRIBUTE
    },
    targetY: {
      type: Types.ATTRIBUTE
    },
    textLength: {
      type: Types.ATTRIBUTE
    },
    viewBox: {
      type: Types.ATTRIBUTE
    },
    viewTarget: {
      type: Types.ATTRIBUTE
    },
    xChannelSelector: {
      type: Types.ATTRIBUTE
    },
    yChannelSelector: {
      type: Types.ATTRIBUTE
    },
    zoomAndPan: {
      type: Types.ATTRIBUTE
    }
  };

// list of Element events that will not be delegated even if camelCased
const NonComposedEvents = new Set([
  "abort",
  "animationstart",
  "animationend",
  "animationiteration",
  "blur",
  "change",
  "copy",
  "cut",
  "error",
  "focus",
  "gotpointercapture",
  "load",
  "loadend",
  "loadstart",
  "lostpointercapture",
  "mouseenter",
  "mouseleave",
  "paste",
  "progress",
  "reset",
  "scroll",
  "select",
  "submit",
  "transitionstart",
  "transitioncancel",
  "transitionend",
  "transitionrun"
]);

const SVGElements = new Set([
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

export { Attributes, SVGAttributes, NonComposedEvents, SVGElements };
