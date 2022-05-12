/**
 * Based on JSX types for Surplus and Inferno and adapted for `dom-expressions`.
 *
 * https://github.com/adamhaile/surplus/blob/master/index.d.ts
 * https://github.com/infernojs/inferno/blob/master/packages/inferno/src/core/types.ts
 */
type DOMElement = Element;

export namespace JSX {
  type FunctionMaybe<T = unknown> = ({ (): T }) | T;
  type Element =
    | Node
    | ArrayElement
    | FunctionElement
    | (string & {})
    | number
    | boolean
    | null
    | undefined;
  interface ArrayElement extends Array<Element> {}
  interface FunctionElement {
    (): Element;
  }
  interface ElementClass {
    // empty, libs can define requirements downstream
  }
  interface ElementAttributesProperty {
    // empty, libs can define requirements downstream
  }
  interface ElementChildrenAttribute {
    children: {};
  }
  interface EventHandler<T, E extends Event> {
    (
      e: E & {
        currentTarget: T;
        target: DOMElement;
      }
    ): void;
  }
  interface BoundEventHandler<T, E extends Event> {
    0: (
      data: any,
      e: E & {
        currentTarget: T;
        target: DOMElement;
      }
    ) => void;
    1: any;
  }
  type EventHandlerUnion<T, E extends Event> = EventHandler<T, E> | BoundEventHandler<T, E>;
  interface IntrinsicAttributes {
    ref?: unknown | ((e: unknown) => void);
  }
  interface CustomAttributes<T> {
    ref?: T | ((el: T) => void);
    classList?: {
      [k: string]: boolean | undefined;
    };
    $ServerOnly?: boolean;
  }
  type Accessor<T> = () => T
  interface Directives {}
  interface DirectiveFunctions {
    [x: string]: (el: Element, accessor: Accessor<any>) => void;
  }
  interface ExplicitProperties {}
  interface ExplicitAttributes {}
  interface CustomEvents {}
  interface CustomCaptureEvents {}
  type DirectiveAttributes = {
    [Key in keyof Directives as `use:${Key}`]?: Directives[Key];
  };
  type DirectiveFunctionAttributes<T> = {
    [K in keyof DirectiveFunctions as string extends K ? never : `use:${K}`]?: DirectiveFunctions[K] extends (
      el: infer E, // will be unknown if not provided
      ...rest: infer R // use rest so that we can check whether it's provided or not
    ) => void
      ? T extends E // everything extends unknown if E is unknown
        ? R extends [infer A] // check if has accessor provided
          ? A extends Accessor<infer V>
            ? V // it's an accessor
            : never // it isn't, type error
          : true // no accessor provided
        : never // T is the wrong element
      : never; // it isn't a function
  };
  type PropAttributes = {
    [Key in keyof ExplicitProperties as `prop:${Key}`]?: ExplicitProperties[Key];
  };
  type AttrAttributes = {
    [Key in keyof ExplicitAttributes as `attr:${Key}`]?: ExplicitAttributes[Key];
  };
  type OnAttributes<T> = {
    [Key in keyof CustomEvents as `on:${Key}`]?: EventHandler<T, CustomEvents[Key]>;
  }
  type OnCaptureAttributes<T> = {
    [Key in keyof CustomCaptureEvents as `oncapture:${Key}`]?: EventHandler<T, CustomCaptureEvents[Key]>;
  }
  interface DOMAttributes<T> extends CustomAttributes<T>, DirectiveAttributes, DirectiveFunctionAttributes<T>, PropAttributes, AttrAttributes, OnAttributes<T>, OnCaptureAttributes<T> {
    children?: Element;
    innerHTML?: string;
    innerText?: string | number;
    textContent?: string | number;
    onCopy?: EventHandlerUnion<T, ClipboardEvent>;
    onCut?: EventHandlerUnion<T, ClipboardEvent>;
    onPaste?: EventHandlerUnion<T, ClipboardEvent>;
    onCompositionEnd?: EventHandlerUnion<T, CompositionEvent>;
    onCompositionStart?: EventHandlerUnion<T, CompositionEvent>;
    onCompositionUpdate?: EventHandlerUnion<T, CompositionEvent>;
    onFocus?: EventHandlerUnion<T, FocusEvent>;
    onFocusOut?: EventHandlerUnion<T, FocusEvent>;
    onFocusIn?: EventHandlerUnion<T, FocusEvent>;
    onBlur?: EventHandlerUnion<T, FocusEvent>;
    onChange?: EventHandlerUnion<T, Event>;
    onInvalid?: EventHandlerUnion<T, Event>;
    onInput?: EventHandlerUnion<T, InputEvent>;
    onBeforeInput?: EventHandlerUnion<T, InputEvent>;
    onReset?: EventHandlerUnion<T, Event>;
    onSubmit?: EventHandlerUnion<
      T,
      Event & {
        submitter: HTMLElement;
      }
    >;
    onLoad?: EventHandlerUnion<T, Event>;
    onError?: EventHandlerUnion<T, Event>;
    onKeyDown?: EventHandlerUnion<T, KeyboardEvent>;
    onKeyPress?: EventHandlerUnion<T, KeyboardEvent>;
    onKeyUp?: EventHandlerUnion<T, KeyboardEvent>;
    onGotPointerCapture?: EventHandlerUnion<T, PointerEvent>;
    onLostPointerCapture?: EventHandlerUnion<T, PointerEvent>;
    onPointerCancel?: EventHandlerUnion<T, PointerEvent>;
    onPointerDown?: EventHandlerUnion<T, PointerEvent>;
    onPointerEnter?: EventHandlerUnion<T, PointerEvent>;
    onPointerLeave?: EventHandlerUnion<T, PointerEvent>;
    onPointerMove?: EventHandlerUnion<T, PointerEvent>;
    onPointerOver?: EventHandlerUnion<T, PointerEvent>;
    onPointerOut?: EventHandlerUnion<T, PointerEvent>;
    onPointerUp?: EventHandlerUnion<T, PointerEvent>;
    onAbort?: EventHandlerUnion<T, Event>;
    onCanPlay?: EventHandlerUnion<T, Event>;
    onCanPlayThrough?: EventHandlerUnion<T, Event>;
    onDurationChange?: EventHandlerUnion<T, Event>;
    onEmptied?: EventHandlerUnion<T, Event>;
    onEncrypted?: EventHandlerUnion<T, Event>;
    onEnded?: EventHandlerUnion<T, Event>;
    onLoadedData?: EventHandlerUnion<T, Event>;
    onLoadedMetadata?: EventHandlerUnion<T, Event>;
    onLoadStart?: EventHandlerUnion<T, Event>;
    onPause?: EventHandlerUnion<T, Event>;
    onPlay?: EventHandlerUnion<T, Event>;
    onPlaying?: EventHandlerUnion<T, Event>;
    onProgress?: EventHandlerUnion<T, Event>;
    onRateChange?: EventHandlerUnion<T, Event>;
    onSeeked?: EventHandlerUnion<T, Event>;
    onSeeking?: EventHandlerUnion<T, Event>;
    onStalled?: EventHandlerUnion<T, Event>;
    onSuspend?: EventHandlerUnion<T, Event>;
    onTimeUpdate?: EventHandlerUnion<T, Event>;
    onVolumeChange?: EventHandlerUnion<T, Event>;
    onWaiting?: EventHandlerUnion<T, Event>;
    onClick?: EventHandlerUnion<T, MouseEvent>;
    onContextMenu?: EventHandlerUnion<T, MouseEvent>;
    onDblClick?: EventHandlerUnion<T, MouseEvent>;
    onDrag?: EventHandlerUnion<T, DragEvent>;
    onDragEnd?: EventHandlerUnion<T, DragEvent>;
    onDragEnter?: EventHandlerUnion<T, DragEvent>;
    onDragExit?: EventHandlerUnion<T, DragEvent>;
    onDragLeave?: EventHandlerUnion<T, DragEvent>;
    onDragOver?: EventHandlerUnion<T, DragEvent>;
    onDragStart?: EventHandlerUnion<T, DragEvent>;
    onDrop?: EventHandlerUnion<T, DragEvent>;
    onMouseDown?: EventHandlerUnion<T, MouseEvent>;
    onMouseEnter?: EventHandlerUnion<T, MouseEvent>;
    onMouseLeave?: EventHandlerUnion<T, MouseEvent>;
    onMouseMove?: EventHandlerUnion<T, MouseEvent>;
    onMouseOut?: EventHandlerUnion<T, MouseEvent>;
    onMouseOver?: EventHandlerUnion<T, MouseEvent>;
    onMouseUp?: EventHandlerUnion<T, MouseEvent>;
    onSelect?: EventHandlerUnion<T, UIEvent>;
    onTouchCancel?: EventHandlerUnion<T, TouchEvent>;
    onTouchEnd?: EventHandlerUnion<T, TouchEvent>;
    onTouchMove?: EventHandlerUnion<T, TouchEvent>;
    onTouchStart?: EventHandlerUnion<T, TouchEvent>;
    onScroll?: EventHandlerUnion<T, UIEvent>;
    onWheel?: EventHandlerUnion<T, WheelEvent>;
    onAnimationStart?: EventHandlerUnion<T, AnimationEvent>;
    onAnimationEnd?: EventHandlerUnion<T, AnimationEvent>;
    onAnimationIteration?: EventHandlerUnion<T, AnimationEvent>;
    onTransitionEnd?: EventHandlerUnion<T, TransitionEvent>;

    // lower case events
    oncopy?: EventHandlerUnion<T, ClipboardEvent>;
    oncut?: EventHandlerUnion<T, ClipboardEvent>;
    onpaste?: EventHandlerUnion<T, ClipboardEvent>;
    oncompositionend?: EventHandlerUnion<T, CompositionEvent>;
    oncompositionstart?: EventHandlerUnion<T, CompositionEvent>;
    oncompositionupdate?: EventHandlerUnion<T, CompositionEvent>;
    onfocus?: EventHandlerUnion<T, FocusEvent>;
    onfocusout?: EventHandlerUnion<T, FocusEvent>;
    onfocusin?: EventHandlerUnion<T, FocusEvent>;
    onblur?: EventHandlerUnion<T, FocusEvent>;
    onchange?: EventHandlerUnion<T, Event>;
    oninvalid?: EventHandlerUnion<T, Event>;
    oninput?: EventHandlerUnion<T, InputEvent>;
    onbeforeinput?: EventHandlerUnion<T, InputEvent>;
    onreset?: EventHandlerUnion<T, Event>;
    onsubmit?: EventHandlerUnion<
      T,
      Event & {
        submitter: HTMLElement;
      }
    >;
    onload?: EventHandlerUnion<T, Event>;
    onerror?: EventHandlerUnion<T, Event>;
    onkeydown?: EventHandlerUnion<T, KeyboardEvent>;
    onkeypress?: EventHandlerUnion<T, KeyboardEvent>;
    onkeyup?: EventHandlerUnion<T, KeyboardEvent>;
    ongotpointercapture?: EventHandlerUnion<T, PointerEvent>;
    onlostpointercapture?: EventHandlerUnion<T, PointerEvent>;
    onpointercancel?: EventHandlerUnion<T, PointerEvent>;
    onpointerdown?: EventHandlerUnion<T, PointerEvent>;
    onpointerenter?: EventHandlerUnion<T, PointerEvent>;
    onpointerleave?: EventHandlerUnion<T, PointerEvent>;
    onpointermove?: EventHandlerUnion<T, PointerEvent>;
    onpointerover?: EventHandlerUnion<T, PointerEvent>;
    onpointerout?: EventHandlerUnion<T, PointerEvent>;
    onpointerup?: EventHandlerUnion<T, PointerEvent>;
    onabort?: EventHandlerUnion<T, Event>;
    oncanplay?: EventHandlerUnion<T, Event>;
    oncanplaythrough?: EventHandlerUnion<T, Event>;
    ondurationchange?: EventHandlerUnion<T, Event>;
    onemptied?: EventHandlerUnion<T, Event>;
    onencrypted?: EventHandlerUnion<T, Event>;
    onended?: EventHandlerUnion<T, Event>;
    onloadeddata?: EventHandlerUnion<T, Event>;
    onloadedmetadata?: EventHandlerUnion<T, Event>;
    onloadstart?: EventHandlerUnion<T, Event>;
    onpause?: EventHandlerUnion<T, Event>;
    onplay?: EventHandlerUnion<T, Event>;
    onplaying?: EventHandlerUnion<T, Event>;
    onprogress?: EventHandlerUnion<T, Event>;
    onratechange?: EventHandlerUnion<T, Event>;
    onseeked?: EventHandlerUnion<T, Event>;
    onseeking?: EventHandlerUnion<T, Event>;
    onstalled?: EventHandlerUnion<T, Event>;
    onsuspend?: EventHandlerUnion<T, Event>;
    ontimeupdate?: EventHandlerUnion<T, Event>;
    onvolumechange?: EventHandlerUnion<T, Event>;
    onwaiting?: EventHandlerUnion<T, Event>;
    onclick?: EventHandlerUnion<T, MouseEvent>;
    oncontextmenu?: EventHandlerUnion<T, MouseEvent>;
    ondblclick?: EventHandlerUnion<T, MouseEvent>;
    ondrag?: EventHandlerUnion<T, DragEvent>;
    ondragend?: EventHandlerUnion<T, DragEvent>;
    ondragenter?: EventHandlerUnion<T, DragEvent>;
    ondragexit?: EventHandlerUnion<T, DragEvent>;
    ondragleave?: EventHandlerUnion<T, DragEvent>;
    ondragover?: EventHandlerUnion<T, DragEvent>;
    ondragstart?: EventHandlerUnion<T, DragEvent>;
    ondrop?: EventHandlerUnion<T, DragEvent>;
    onmousedown?: EventHandlerUnion<T, MouseEvent>;
    onmouseenter?: EventHandlerUnion<T, MouseEvent>;
    onmouseleave?: EventHandlerUnion<T, MouseEvent>;
    onmousemove?: EventHandlerUnion<T, MouseEvent>;
    onmouseout?: EventHandlerUnion<T, MouseEvent>;
    onmouseover?: EventHandlerUnion<T, MouseEvent>;
    onmouseup?: EventHandlerUnion<T, MouseEvent>;
    onselect?: EventHandlerUnion<T, UIEvent>;
    ontouchcancel?: EventHandlerUnion<T, TouchEvent>;
    ontouchend?: EventHandlerUnion<T, TouchEvent>;
    ontouchmove?: EventHandlerUnion<T, TouchEvent>;
    ontouchstart?: EventHandlerUnion<T, TouchEvent>;
    onscroll?: EventHandlerUnion<T, UIEvent>;
    onwheel?: EventHandlerUnion<T, WheelEvent>;
    onanimationstart?: EventHandlerUnion<T, AnimationEvent>;
    onanimationend?: EventHandlerUnion<T, AnimationEvent>;
    onanimationiteration?: EventHandlerUnion<T, AnimationEvent>;
    ontransitionend?: EventHandlerUnion<T, TransitionEvent>;
  }
  type CSSWideKeyword = "initial" | "inherit" | "unset";
  type CSSPercentage = string;
  type CSSLength = number | string;
  interface CSSProperties {
    /**
     * Aligns a flex container's lines within the flex container when there is extra space in the cross-axis, similar to how justify-content aligns individual items within the main-axis.
     */
    "align-content"?:
      | CSSWideKeyword
      | "flex-start"
      | "flex-end"
      | "center"
      | "space-between"
      | "space-around"
      | "stretch";
    /**
     * Sets the default alignment in the cross axis for all of the flex container's items, including anonymous flex items, similarly to how justify-content aligns items along the main axis.
     */
    "align-items"?: CSSWideKeyword | "flex-start" | "flex-end" | "center" | "baseline" | "stretch";
    /**
     * Allows the default alignment to be overridden for individual flex items.
     */
    "align-self"?:
      | CSSWideKeyword
      | "auto"
      | "flex-start"
      | "flex-end"
      | "center"
      | "baseline"
      | "stretch";
    /**
     * This property allows precise alignment of elements, such as graphics,
     * that do not have a baseline-table or lack the desired baseline in their baseline-table.
     * With the alignment-adjust property, the position of the baseline identified by the alignment-baseline
     * can be explicitly determined. It also determines precisely the alignment point for each glyph within a textual element.
     */
    "alignment-adjust"?: CSSWideKeyword | any;
    "alignment-baseline"?: CSSWideKeyword | any;
    /**
     * Defines a length of time to elapse before an animation starts, allowing an animation to begin execution some time after it is applied.
     */
    "animation-delay"?: CSSWideKeyword | any;
    /**
     * Defines whether an animation should run in reverse on some or all cycles.
     */
    "animation-direction"?: CSSWideKeyword | any;
    /**
     * Defines how long an animation runs for.
     */
     "animation-duration"?: CSSWideKeyword | any;
    /**
     * Specifies how many times an animation cycle should play.
     */
    "animation-iteration-count"?: CSSWideKeyword | any;
    /**
     * Defines the list of animations that apply to the element.
     */
    "animation-name"?: CSSWideKeyword | any;
    /**
     * Defines whether an animation is running or paused.
     */
    "animation-play-state"?: CSSWideKeyword | any;
    /**
     * Allows changing the style of any element to platform-based interface elements or vice versa.
     */
    appearance?: CSSWideKeyword | any;
    /**
     * Determines whether or not the “back” side of a transformed element is visible when facing the viewer.
     */
    "backface-visibility"?: CSSWideKeyword | any;
    /**
     * Shorthand property to set the values for one or more of:
     * background-clip, background-color, background-image,
     * background-origin, background-position, background-repeat,
     * background-size, and background-attachment.
     */
    background?: CSSWideKeyword | any;
    /**
     * If a background-image is specified, this property determines
     * whether that image's position is fixed within the viewport,
     * or scrolls along with its containing block.
     * See CSS 3 background-attachment property https://drafts.csswg.org/css-backgrounds-3/#the-background-attachment
     */
    "background-attachment"?: CSSWideKeyword | "scroll" | "fixed" | "local";
    /**
     * This property describes how the element's background images should blend with each other and the element's background color.
     * The value is a list of blend modes that corresponds to each background image. Each element in the list will apply to the
     * corresponding element of background-image. If a property doesn’t have enough comma-separated values to match the number of layers,
     * the UA must calculate its used value by repeating the list of values until there are enough.
     */
    "background-blend-mode"?: CSSWideKeyword | any;
    /**
     * Sets the background color of an element.
     */
    "background-color"?: CSSWideKeyword | any;
    "background-composite"?: CSSWideKeyword | any;
    /**
     * Applies one or more background images to an element. These can be any valid CSS image, including url() paths to image files or CSS gradients.
     */
    "background-image"?: CSSWideKeyword | any;
    /**
     * Specifies what the background-position property is relative to.
     */
    "background-origin"?: CSSWideKeyword | any;
    /**
     * Sets the position of a background image.
     */
    "background-position"?: CSSWideKeyword | any;
    /**
     * Background-repeat defines if and how background images will be repeated after they have been sized and positioned
     */
    "background-repeat"?: CSSWideKeyword | any;
    /**
     * Defines the size of the background images
     */
    "background-size"?: CSSWideKeyword | any;
    /**
     * Obsolete - spec retired, not implemented.
     */
    "baseline-shift"?: CSSWideKeyword | any;
    /**
     * Non standard. Sets or retrieves the location of the Dynamic HTML (DHTML) behavior.
     */
    behavior?: CSSWideKeyword | any;
    /**
     * Shorthand property that defines the different properties of all four sides of an element's border in a single declaration.
     * It can be used to set border-width, border-style and border-color, or a subset of these.
     */
    border?: CSSWideKeyword | any;
    /**
     * Shorthand that sets the values of border-bottom-color,
     * border-bottom-style, and border-bottom-width.
     */
    "border-bottom"?: CSSWideKeyword | any;
    /**
     * Sets the color of the bottom border of an element.
     */
    "border-bottom-color"?: CSSWideKeyword | any;
    /**
     * Defines the shape of the border of the bottom-left corner.
     */
    "border-bottom-left-radius"?: CSSWideKeyword | CSSLength;
    /**
     * Defines the shape of the border of the bottom-right corner.
     */
    "border-bottom-right-radius"?: CSSWideKeyword | CSSLength;
    /**
     * Sets the line style of the bottom border of a box.
     */
    "border-bottom-style"?: CSSWideKeyword | any;
    /**
     * Sets the width of an element's bottom border. To set all four borders,
     * use the border-width shorthand property which sets the values simultaneously for border-top-width,
     * border-right-width, border-bottom-width, and border-left-width.
     */
    "border-bottom-width"?: CSSWideKeyword | any;
    /**
     * Border-collapse can be used for collapsing the borders between table cells
     */
    "border-collapse"?: CSSWideKeyword | any;
    /**
     * The CSS border-color property sets the color of an element's four borders.
     * This property can have from one to four values, made up of the elementary properties:
     *      •       border-top-color
     *      •       border-right-color
     *      •       border-bottom-color
     *      •       border-left-color The default color is the currentColor of each of these values.
     * If you provide one value, it sets the color for the element. Two values set the horizontal and vertical values,
     * respectively. Providing three values sets the top, vertical, and bottom values, in that order.
     * Four values set all for sides: top, right, bottom, and left, in that order.
     */
    "border-color"?: CSSWideKeyword | any;
    /**
     * Specifies different corner clipping effects, such as scoop (inner curves), bevel (straight cuts) or notch (cut-off rectangles).
     * Works along with border-radius to specify the size of each corner effect.
     */
    "border-corner-shape"?: CSSWideKeyword | any;
    /**
     * The property border-image-source is used to set the image to be used instead of the border style.
     * If this is set to none the border-style is used instead.
     */
    "border-image-source"?: CSSWideKeyword | any;
    /**
     * The border-image-width CSS property defines the offset to use for dividing the border image in nine parts,
     * the top-left corner, central top edge, top-right-corner, central right edge, bottom-right corner, central bottom edge,
     * bottom-left corner, and central right edge. They represent inward distance from the top, right, bottom, and left edges.
     */
    "border-image-width"?: CSSWideKeyword | any;
    /**
     * Shorthand property that defines the border-width, border-style and border-color of an element's left border in a single declaration.
     * Note that you can use the corresponding longhand properties to set specific individual properties of the left border — border-left-width,
     * border-left-style and border-left-color.
     */
    "border-left"?: CSSWideKeyword | any;
    /**
     * The CSS border-left-color property sets the color of an element's left border. This page explains the border-left-color value,
     * but often you will find it more convenient to fix the border's left color as part of a shorthand set, either border-left or border-color.
     * Colors can be defined several ways. For more information, see Usage.
     */
    "border-left-color"?: CSSWideKeyword | any;
    /**
     * Sets the style of an element's left border. To set all four borders, use the shorthand property, border-style.
     * Otherwise, you can set the borders individually with border-top-style, border-right-style, border-bottom-style, border-left-style.
     */
    "border-left-style"?: CSSWideKeyword | any;
    /**
     * Sets the width of an element's left border. To set all four borders,
     * use the border-width shorthand property which sets the values simultaneously for border-top-width,
     * border-right-width, border-bottom-width, and border-left-width.
     */
    "border-left-width"?: CSSWideKeyword | any;
    /**
     * Shorthand property that sets the rounding of all four corners.
     */
    "border-radius"?: CSSWideKeyword | CSSLength;
    /**
     * Shorthand property that defines the border-width, border-style and border-color of an element's right border
     * in a single declaration. Note that you can use the corresponding longhand properties to set specific
     * individual properties of the right border — border-right-width, border-right-style and border-right-color.
     */
    "border-right"?: CSSWideKeyword | any;
    /**
     * Sets the color of an element's right border. This page explains the border-right-color value,
     * but often you will find it more convenient to fix the border's right color as part of a shorthand set,
     * either border-right or border-color.
     * Colors can be defined several ways. For more information, see Usage.
     */
    "border-right-color"?: CSSWideKeyword | any;
    /**
     * Sets the style of an element's right border. To set all four borders, use the shorthand property,
     * border-style. Otherwise, you can set the borders individually with border-top-style, border-right-style,
     * border-bottom-style, border-left-style.
     */
    "border-right-style"?: CSSWideKeyword | any;
    /**
     * Sets the width of an element's right border. To set all four borders,
     * use the border-width shorthand property which sets the values simultaneously for border-top-width,
     * border-right-width, border-bottom-width, and border-left-width.
     */
    "border-right-width"?: CSSWideKeyword | any;
    /**
     * Specifies the distance between the borders of adjacent cells.
     */
    "border-spacing"?: CSSWideKeyword | any;
    /**
     * Sets the style of an element's four borders. This property can have from one to four values.
     * With only one value, the value will be applied to all four borders;
     * otherwise, this works as a shorthand property for each of border-top-style, border-right-style,
     * border-bottom-style, border-left-style, where each border style may be assigned a separate value.
     */
    "border-style"?: CSSWideKeyword | any;
    /**
     * Shorthand property that defines the border-width, border-style and border-color of an element's top border
     * in a single declaration. Note that you can use the corresponding longhand properties to set specific
     * individual properties of the top border — border-top-width, border-top-style and border-top-color.
     */
    "border-top"?: CSSWideKeyword | any;
    /**
     * Sets the color of an element's top border. This page explains the border-top-color value,
     * but often you will find it more convenient to fix the border's top color as part of a shorthand set,
     * either border-top or border-color.
     * Colors can be defined several ways. For more information, see Usage.
     */
    "border-top-color"?: CSSWideKeyword | any;
    /**
     * Sets the rounding of the top-left corner of the element.
     */
    "border-top-left-radius"?: CSSWideKeyword | CSSLength;
    /**
     * Sets the rounding of the top-right corner of the element.
     */
    "border-top-right-radius"?: CSSWideKeyword | CSSLength;
    /**
     * Sets the style of an element's top border. To set all four borders, use the shorthand property, border-style.
     * Otherwise, you can set the borders individually with border-top-style, border-right-style, border-bottom-style, border-left-style.
     */
    "border-top-style"?: CSSWideKeyword | any;
    /**
     * Sets the width of an element's top border. To set all four borders,
     * use the border-width shorthand property which sets the values simultaneously for border-top-width,
     * border-right-width, border-bottom-width, and border-left-width.
     */
    "border-top-width"?: CSSWideKeyword | any;
    /**
     * Sets the width of an element's four borders. This property can have from one to four values.
     * This is a shorthand property for setting values simultaneously for border-top-width,
     * border-right-width, border-bottom-width, and border-left-width.
     */
    "border-width"?: CSSWideKeyword | any;
    /**
     * This property specifies how far an absolutely positioned box's bottom margin edge
     * is offset above the bottom edge of the box's containing block. For relatively positioned boxes,
     * the offset is with respect to the bottom edges of the box itself
     * (i.e., the box is given a position in the normal flow, then offset from that position according to these properties).
     */
    bottom?: CSSWideKeyword | any;
    /**
     * Obsolete.
     */
    "box-align"?: CSSWideKeyword | any;
    /**
     * Breaks a box into fragments creating new borders,
     * padding and repeating backgrounds or lets it stay as a continuous box on a page break,
     * column break, or, for inline elements, at a line break.
     */
    "box-decoration-break"?: CSSWideKeyword | any;
    /**
     * Deprecated
     */
    "box-direction"?: CSSWideKeyword | any;
    /**
     * Do not use. This property has been replaced by the flex-wrap property.
     * Gets or sets a value that specifies the direction to add successive rows or columns when the value of box-lines is set to multiple.
     */
    "box-line-progression"?: CSSWideKeyword | any;
    /**
     * Do not use. This property has been replaced by the flex-wrap property.
     * Gets or sets a value that specifies whether child elements wrap onto multiple lines or columns based on the space available in the object.
     */
    "box-lines"?: CSSWideKeyword | any;
    /**
     * Do not use. This property has been replaced by flex-order.
     * Specifies the ordinal group that a child element of the object belongs to.
     * This ordinal value identifies the display order (along the axis defined by the box-orient property) for the group.
     */
    "box-ordinal-group"?: CSSWideKeyword | any;
    /**
     * Deprecated.
     */
    "box-flex"?: CSSWideKeyword | number;
    /**
     * Deprecated.
     */
    "box-flex-group"?: CSSWideKeyword | number;
    /**
     * Cast a drop shadow from the frame of almost any element.
     * MDN: https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow
     */
    "box-shadow"?: CSSWideKeyword | any;
    /**
     * The CSS break-after property allows you to force a break on multi-column layouts.
     * More specifically, it allows you to force a break after an element.
     * It allows you to determine if a break should occur, and what type of break it should be.
     * The break-after CSS property describes how the page, column or region break behaves after the generated box.
     * If there is no generated box, the property is ignored.
     */
    "break-after"?: CSSWideKeyword | any;
    /**
     * Control page/column/region breaks that fall above a block of content
     */
    "break-before"?: CSSWideKeyword | any;
    /**
     * Control page/column/region breaks that fall within a block of content
     */
    "break-inside"?: CSSWideKeyword | any;
    /**
     * The clear CSS property specifies if an element can be positioned next to
     * or must be positioned below the floating elements that precede it in the markup.
     */
    clear?: CSSWideKeyword | any;
    /**
     * Deprecated; see clip-path.
     * Lets you specify the dimensions of an absolutely positioned element that should be visible,
     * and the element is clipped into this shape, and displayed.
     */
    clip?: CSSWideKeyword | any;
    /**
     * Clipping crops an graphic, so that only a portion of the graphic is rendered, or filled.
     * This clip-rule property, when used with the clip-path property, defines which clip rule, or algorithm,
     * to use when filling the different parts of a graphics.
     */
    "clip-rule"?: CSSWideKeyword | any;
    /**
     * The color property sets the color of an element's foreground content (usually text),
     * accepting any standard CSS color from keywords and hex values to RGB(a) and HSL(a).
     */
    color?: CSSWideKeyword | any;
    /**
     * Describes the number of columns of the element.
     * See CSS 3 column-count property https://www.w3.org/TR/css3-multicol/#cc
     */
    "column-count"?: CSSWideKeyword | number | "auto";
    /**
     * Specifies how to fill columns (balanced or sequential).
     */
    "column-fill"?: CSSWideKeyword | any;
    /**
     * The column-gap property controls the width of the gap between columns in multi-column elements.
     */
    "column-gap"?: CSSWideKeyword | any;
    /**
     * Sets the width, style, and color of the rule between columns.
     */
    "column-rule"?: CSSWideKeyword | any;
    /**
     * Specifies the color of the rule between columns.
     */
    "column-rule-color"?: CSSWideKeyword | any;
    /**
     * Specifies the width of the rule between columns.
     */
    "column-rule-width"?: CSSWideKeyword | any;
    /**
     * The column-span CSS property makes it possible for an element to span across all columns when its value is set to all.
     * An element that spans more than one column is called a spanning element.
     */
    "column-span"?: CSSWideKeyword | any;
    /**
     * Specifies the width of columns in multi-column elements.
     */
    "column-width"?: CSSWideKeyword | any;
    /**
     * This property is a shorthand property for setting column-width and/or column-count.
     */
    columns?: CSSWideKeyword | any;
    /**
     * The counter-increment property accepts one or more names of counters (identifiers),
     * each one optionally followed by an integer which specifies the value by which the counter should be incremented
     * (e.g. if the value is 2, the counter increases by 2 each time it is invoked).
     */
    "counter-increment"?: CSSWideKeyword | any;
    /**
     * The counter-reset property contains a list of one or more names of counters,
     * each one optionally followed by an integer (otherwise, the integer defaults to 0.).
     * Each time the given element is invoked, the counters specified by the property are set to the given integer.
     */
    "counter-reset"?: CSSWideKeyword | any;
    /**
     * The cue property specifies sound files (known as an "auditory icon") to be played by speech media agents
     * before and after presenting an element's content; if only one file is specified, it is played both before and after.
     * The volume at which the file(s) should be played, relative to the volume of the main element, may also be specified.
     * The icon files may also be set separately with the cue-before and cue-after properties.
     */
    cue?: CSSWideKeyword | any;
    /**
     * The cue-after property specifies a sound file (known as an "auditory icon") to be played by speech media agents
     * after presenting an element's content; the volume at which the file should be played may also be specified.
     * The shorthand property cue sets cue sounds for both before and after the element is presented.
     */
    "cue-after"?: CSSWideKeyword | any;
    /**
     * Specifies the mouse cursor displayed when the mouse pointer is over an element.
     */
    cursor?: CSSWideKeyword | any;
    /**
     * The direction CSS property specifies the text direction/writing direction. The rtl is used for Hebrew or Arabic text, the ltr is for other languages.
     */
    direction?: CSSWideKeyword | any;
    /**
     * This property specifies the type of rendering box used for an element. It is a shorthand property for many other display properties.
     */
    display?: CSSWideKeyword | any;
    /**
     * The ‘fill’ property paints the interior of the given graphical element.
     * The area to be painted consists of any areas inside the outline of the shape.
     * To determine the inside of the shape, all subpaths are considered,
     * and the interior is determined according to the rules associated with the current value of the ‘fill-rule’ property.
     * The zero-width geometric outline of a shape is included in the area to be painted.
     */
    fill?: CSSWideKeyword | any;
    /**
     * SVG: Specifies the opacity of the color or the content the current object is filled with.
     * See SVG 1.1 https://www.w3.org/TR/SVG/painting.html#FillOpacityProperty
     */
    "fill-opacity"?: CSSWideKeyword | number;
    /**
     * The ‘fill-rule’ property indicates the algorithm which is to be used to determine what parts of the canvas are included inside the shape.
     * For a simple, non-intersecting path, it is intuitively clear what region lies "inside";
     * however, for a more complex path, such as a path that intersects itself or where one subpath encloses another,
     * the interpretation of "inside" is not so obvious.
     * The ‘fill-rule’ property provides two options for how the inside of a shape is determined:
     */
    "fill-rule"?: CSSWideKeyword | any;
    /**
     * Applies various image processing effects. This property is largely unsupported. See Compatibility section for more information.
     */
    filter?: CSSWideKeyword | any;
    /**
     * Shorthand for `flex-grow`, `flex-shrink`, and `flex-basis`.
     */
    flex?: CSSWideKeyword | number | string;
    /**
     * Obsolete, do not use. This property has been renamed to align-items.
     * Specifies the alignment (perpendicular to the layout axis defined by the flex-direction property) of child elements of the object.
     */
    "flex-align"?: CSSWideKeyword | any;
    /**
     * The flex-basis CSS property describes the initial main size of the flex item
     * before any free space is distributed according to the flex factors described in the flex property (flex-grow and flex-shrink).
     */
    "flex-basis"?: CSSWideKeyword | any;
    /**
     * The flex-direction CSS property describes how flex items are placed in the flex container, by setting the direction of the flex container's main axis.
     */
    "flex-direction"?: CSSWideKeyword | "row" | "row-reverse" | "column" | "column-reverse";
    /**
     * The flex-flow CSS property defines the flex container's main and cross axis. It is a shorthand property for the flex-direction and flex-wrap properties.
     */
    "flex-flow"?: CSSWideKeyword | string;
    /**
     * Specifies the flex grow factor of a flex item.
     * See CSS flex-grow property https://drafts.csswg.org/css-flexbox-1/#flex-grow-property
     */
    "flex-grow"?: CSSWideKeyword | number;
    /**
     * Do not use. This property has been renamed to align-self
     * Specifies the alignment (perpendicular to the layout axis defined by flex-direction) of child elements of the object.
     */
    "flex-item-align"?: CSSWideKeyword | any;
    /**
     * Do not use. This property has been renamed to align-content.
     * Specifies how a flexbox's lines align within the flexbox when there is extra space along the axis that is perpendicular to the axis defined by the flex-direction property.
     */
    "flex-line-pack"?: CSSWideKeyword | any;
    /**
     * Gets or sets a value that specifies the ordinal group that a flexbox element belongs to. This ordinal value identifies the display order for the group.
     */
    "flex-order"?: CSSWideKeyword | any;
    /**
     * Specifies the flex shrink factor of a flex item.
     * See CSS flex-shrink property https://drafts.csswg.org/css-flexbox-1/#flex-shrink-property
     */
    "flex-shrink"?: CSSWideKeyword | number;
    /**
     * Specifies whether flex items are forced into a single line or can be wrapped onto multiple lines.
     * If wrapping is allowed, this property also enables you to control the direction in which lines are stacked.
     * See CSS flex-wrap property https://drafts.csswg.org/css-flexbox-1/#flex-wrap-property
     */
    "flex-wrap"?: CSSWideKeyword | "nowrap" | "wrap" | "wrap-reverse";
    /**
     * Elements which have the style float are floated horizontally.
     * These elements can move as far to the left or right of the containing element.
     * All elements after the floating element will flow around it, but elements before the floating element are not impacted.
     * If several floating elements are placed after each other, they will float next to each other as long as there is room.
     */
    float?: CSSWideKeyword | any;
    /**
     * Flows content from a named flow (specified by a corresponding flow-into) through selected elements to form a dynamic chain of layout regions.
     */
    "flow-from"?: CSSWideKeyword | any;
    /**
     * The font property is shorthand that allows you to do one of two things: you can either set up six of the most mature font properties in one line,
     * or you can set one of a choice of keywords to adopt a system font setting.
     */
    font?: CSSWideKeyword | any;
    /**
     * The font-family property allows one or more font family names and/or generic family names to be specified for usage on the selected element(s)' text.
     * The browser then goes through the list; for each character in the selection it applies the first font family that has an available glyph for that character.
     */
    "font-family"?: CSSWideKeyword | any;
    /**
     * The font-kerning property allows contextual adjustment of inter-glyph spacing, i.e. the spaces between the characters in text.
     * This property controls <bold>metric kerning</bold> - that utilizes adjustment data contained in the font. Optical Kerning is not supported as yet.
     */
    "font-kerning"?: CSSWideKeyword | any;
    /**
     * Specifies the size of the font. Used to compute em and ex units.
     * See CSS 3 font-size property https://www.w3.org/TR/css-fonts-3/#propdef-font-size
     */
    "font-size"?:
      | CSSWideKeyword
      | "xx-small"
      | "x-small"
      | "small"
      | "medium"
      | "large"
      | "x-large"
      | "xx-large"
      | "larger"
      | "smaller"
      | CSSLength
      | CSSPercentage;
    /**
     * The font-size-adjust property adjusts the font-size of the fallback fonts defined with font-family,
     * so that the x-height is the same no matter what font is used.
     * This preserves the readability of the text when fallback happens.
     * See CSS 3 font-size-adjust property https://www.w3.org/TR/css-fonts-3/#propdef-font-size-adjust
     */
    "font-size-adjust"?: CSSWideKeyword | "none" | number;
    /**
     * Allows you to expand or condense the widths for a normal, condensed, or expanded font face.
     * See CSS 3 font-stretch property https://drafts.csswg.org/css-fonts-3/#propdef-font-stretch
     */
    "font-stretch"?:
      | CSSWideKeyword
      | "normal"
      | "ultra-condensed"
      | "extra-condensed"
      | "condensed"
      | "semi-condensed"
      | "semi-expanded"
      | "expanded"
      | "extra-expanded"
      | "ultra-expanded";
    /**
     * The font-style property allows normal, italic, or oblique faces to be selected.
     * Italic forms are generally cursive in nature while oblique faces are typically sloped versions of the regular face.
     * Oblique faces can be simulated by artificially sloping the glyphs of the regular face.
     * See CSS 3 font-style property https://www.w3.org/TR/css-fonts-3/#propdef-font-style
     */
    "font-style"?: CSSWideKeyword | "normal" | "italic" | "oblique";
    /**
     * This value specifies whether the user agent is allowed to synthesize bold or oblique font faces when a font family lacks bold or italic faces.
     */
    "font-synthesis"?: CSSWideKeyword | any;
    /**
     * The font-variant property enables you to select the small-caps font within a font family.
     */
    "font-variant"?: CSSWideKeyword | any;
    /**
     * Fonts can provide alternate glyphs in addition to default glyph for a character. This property provides control over the selection of these alternate glyphs.
     */
    "font-variant-alternates"?: CSSWideKeyword | any;
    /**
     * Specifies the weight or boldness of the font.
     * See CSS 3 'font-weight' property https://www.w3.org/TR/css-fonts-3/#propdef-font-weight
     */
    "font-weight"?:
      | CSSWideKeyword
      | "normal"
      | "bold"
      | "bolder"
      | "lighter"
      | 100
      | 200
      | 300
      | 400
      | 500
      | 600
      | 700
      | 800
      | 900;
    /**
     * Lays out one or more grid items bound by 4 grid lines. Shorthand for setting grid-column-start, grid-column-end, grid-row-start, and grid-row-end in a single declaration.
     */
    "grid-area"?: CSSWideKeyword | any;
    /**
     * Controls a grid item's placement in a grid area, particularly grid position and a grid span. Shorthand for setting grid-column-start and grid-column-end in a single declaration.
     */
    "grid-column"?: CSSWideKeyword | any;
    /**
     * Controls a grid item's placement in a grid area as well as grid position and a grid span.
     * The grid-column-end property (with grid-row-start, grid-row-end, and grid-column-start) determines a grid item's placement by specifying the grid lines of a grid item's grid area.
     */
    "grid-column-end"?: CSSWideKeyword | any;
    /**
     * Determines a grid item's placement by specifying the starting grid lines of a grid item's grid area.
     * A grid item's placement in a grid area consists of a grid position and a grid span.
     * See also ( grid-row-start, grid-row-end, and grid-column-end)
     */
    "grid-column-start"?: CSSWideKeyword | any;
    /**
     * Gets or sets a value that indicates which row an element within a Grid should appear in. Shorthand for setting grid-row-start and grid-row-end in a single declaration.
     */
    "grid-row"?: CSSWideKeyword | any;
    /**
     * Determines a grid item’s placement by specifying the block-end. A grid item's placement in a grid area consists of a grid position and a grid span.
     * The grid-row-end property (with grid-row-start, grid-column-start, and grid-column-end) determines a grid item's placement by specifying the grid lines of a grid item's grid area.
     */
    "grid-row-end"?: CSSWideKeyword | any;
    /**
     * Specifies a row position based upon an integer location, string value, or desired row size.
     * css/properties/grid-row is used as short-hand for grid-row-position and grid-row-position
     */
    "grid-row-position"?: CSSWideKeyword | any;
    "grid-row-span"?: CSSWideKeyword | any;
    /**
     * Specifies named grid areas which are not associated with any particular grid item, but can be referenced from the grid-placement properties.
     * The syntax of the grid-template-areas property also provides a visualization of the structure of the grid, making the overall layout of the grid container easier to understand.
     */
    "grid-template-areas"?: CSSWideKeyword | any;
    /**
     * Specifies (with grid-template-rows) the line names and track sizing functions of the grid.
     * Each sizing function can be specified as a length, a percentage of the grid container’s size,
     * a measurement of the contents occupying the column or row, or a fraction of the free space in the grid.
     */
    "grid-template-columns"?: CSSWideKeyword | any;
    /**
     * Specifies (with grid-template-columns) the line names and track sizing functions of the grid.
     * Each sizing function can be specified as a length, a percentage of the grid container’s size,
     * a measurement of the contents occupying the column or row, or a fraction of the free space in the grid.
     */
    "grid-template-rows"?: CSSWideKeyword | any;
    /**
     * Sets the height of an element. The content area of the element height does not include the padding, border, and margin of the element.
     */
    height?: CSSWideKeyword | any;
    /**
     * Specifies the minimum number of characters in a hyphenated word
     */
    "hyphenate-limit-chars"?: CSSWideKeyword | any;
    /**
     * Indicates the maximum number of successive hyphenated lines in an element. The ‘no-limit’ value means that there is no limit.
     */
    "hyphenate-limit-lines"?: CSSWideKeyword | any;
    /**
     * Specifies the maximum amount of trailing whitespace (before justification) that may be left in a line before hyphenation is triggered
     * to pull part of a word from the next line back up into the current one.
     */
    "hyphenate-limit-zone"?: CSSWideKeyword | any;
    /**
     * Specifies whether or not words in a sentence can be split by the use of a manual or automatic hyphenation mechanism.
     */
    hyphens?: CSSWideKeyword | any;
    "ime-mode"?: CSSWideKeyword | any;
    /**
     * Defines how the browser distributes space between and around flex items
     * along the main-axis of their container.
     * See CSS justify-content property https://www.w3.org/TR/css-flexbox-1/#justify-content-property
     */
    "justify-content"?:
      | CSSWideKeyword
      | "flex-start"
      | "flex-end"
      | "center"
      | "space-between"
      | "space-around"
      | "space-evenly"
      | "stretch";
    "layout-grid"?: CSSWideKeyword | any;
    "layout-grid-char"?: CSSWideKeyword | any;
    "layout-grid-line"?: CSSWideKeyword | any;
    "layout-grid-mode"?: CSSWideKeyword | any;
    "layout-grid-type"?: CSSWideKeyword | any;
    /**
     * Sets the left edge of an element
     */
    left?: CSSWideKeyword | any;
    /**
     * The letter-spacing CSS property specifies the spacing behavior between text characters.
     */
    "letter-spacing"?: CSSWideKeyword | any;
    /**
     * Deprecated. Gets or sets line-breaking rules for text in selected languages such as Japanese, Chinese, and Korean.
     */
    "line-break"?: CSSWideKeyword | any;
    "line-clamp"?: CSSWideKeyword | number;
    /**
     * Specifies the height of an inline block level element.
     * See CSS 2.1 line-height property https://www.w3.org/TR/CSS21/visudet.html#propdef-line-height
     */
    "line-height"?: CSSWideKeyword | "normal" | number | CSSLength | CSSPercentage;
    /**
     * Shorthand property that sets the list-style-type, list-style-position and list-style-image properties in one declaration.
     */
    "list-style"?: CSSWideKeyword | any;
    /**
     * This property sets the image that will be used as the list item marker. When the image is available,
     * it will replace the marker set with the 'list-style-type' marker. That also means that if the image is not available,
     * it will show the style specified by list-style-property
     */
    "list-style-image"?: CSSWideKeyword | any;
    /**
     * Specifies if the list-item markers should appear inside or outside the content flow.
     */
    "list-style-position"?: CSSWideKeyword | any;
    /**
     * Specifies the type of list-item marker in a list.
     */
    "list-style-type"?: CSSWideKeyword | any;
    /**
     * The margin property is shorthand to allow you to set all four margins of an element at once.
     * Its equivalent longhand properties are margin-top, margin-right, margin-bottom and margin-left.
     * Negative values are also allowed.
     */
    margin?: CSSWideKeyword | any;
    /**
     * margin-bottom sets the bottom margin of an element.
     */
    "margin-bottom"?: CSSWideKeyword | any;
    /**
     * margin-left sets the left margin of an element.
     */
    "margin-left"?: CSSWideKeyword | any;
    /**
     * margin-right sets the right margin of an element.
     */
    "margin-right"?: CSSWideKeyword | any;
    /**
     * margin-top sets the top margin of an element.
     */
    "margin-top"?: CSSWideKeyword | any;
    /**
     * The marquee-direction determines the initial direction in which the marquee content moves.
     */
    "marquee-direction"?: CSSWideKeyword | any;
    /**
     * The 'marquee-style' property determines a marquee's scrolling behavior.
     */
    "marquee-style"?: CSSWideKeyword | any;
    /**
     * This property is shorthand for setting mask-image, mask-mode, mask-repeat, mask-position, mask-clip, mask-origin, mask-composite and mask-size.
     * Omitted values are set to their original properties' initial values.
     */
    mask?: CSSWideKeyword | any;
    /**
     * This property is shorthand for setting mask-border-source, mask-border-slice, mask-border-width, mask-border-outset, and mask-border-repeat.
     * Omitted values are set to their original properties' initial values.
     */
    "mask-border"?: CSSWideKeyword | any;
    /**
     * This property specifies how the images for the sides and the middle part of the mask image are scaled and tiled.
     * The first keyword applies to the horizontal sides, the second one applies to the vertical ones.
     * If the second keyword is absent, it is assumed to be the same as the first, similar to the CSS border-image-repeat property.
     */
    "mask-border-repeat"?: CSSWideKeyword | any;
    /**
     * This property specifies inward offsets from the top, right, bottom, and left edges of the mask image,
     * dividing it into nine regions: four corners, four edges, and a middle.
     * The middle image part is discarded and treated as fully transparent black unless the fill keyword is present.
     * The four values set the top, right, bottom and left offsets in that order, similar to the CSS border-image-slice property.
     */
    "mask-border-slice"?: CSSWideKeyword | any;
    /**
     * Specifies an image to be used as a mask. An image that is empty, fails to download, is non-existent, or cannot be displayed is ignored and does not mask the element.
     */
    "mask-border-source"?: CSSWideKeyword | any;
    /**
     * This property sets the width of the mask box image, similar to the CSS border-image-width property.
     */
    "mask-border-width"?: CSSWideKeyword | any;
    /**
     * Determines the mask painting area, which defines the area that is affected by the mask.
     * The painted content of an element may be restricted to this area.
     */
    "mask-clip"?: CSSWideKeyword | any;
    /**
     * For elements rendered as a single box, specifies the mask positioning area.
     * For elements rendered as multiple boxes (e.g., inline boxes on several lines, boxes on several pages)
     * specifies which boxes box-decoration-break operates on to determine the mask positioning area(s).
     */
    "mask-origin"?: CSSWideKeyword | any;
    /**
     * This property must not be used. It is no longer included in any standard or standard track specification,
     * nor is it implemented in any browser. It is only used when the text-align-last property is set to size.
     * It controls allowed adjustments of font-size to fit line content.
     */
    "max-font-size"?: CSSWideKeyword | any;
    /**
     * Sets the maximum height for an element. It prevents the height of the element to exceed the specified value.
     * If min-height is specified and is greater than max-height, max-height is overridden.
     */
    "max-height"?: CSSWideKeyword | any;
    /**
     * Sets the maximum width for an element. It limits the width property to be larger than the value specified in max-width.
     */
    "max-width"?: CSSWideKeyword | any;
    /**
     * Sets the minimum height for an element. It prevents the height of the element to be smaller than the specified value.
     * The value of min-height overrides both max-height and height.
     */
    "min-height"?: CSSWideKeyword | any;
    /**
     * Sets the minimum width of an element. It limits the width property to be not smaller than the value specified in min-width.
     */
    "min-width"?: CSSWideKeyword | any;
    /**
     * Specifies the transparency of an element.
     * See CSS 3 opacity property https://drafts.csswg.org/css-color-3/#opacity
     */
    opacity?: CSSWideKeyword | number;
    /**
     * Specifies the order used to lay out flex items in their flex container.
     * Elements are laid out in the ascending order of the order value.
     * See CSS order property https://drafts.csswg.org/css-flexbox-1/#order-property
     */
    order?: CSSWideKeyword | number;
    /**
     * In paged media, this property defines the minimum number of lines in
     * a block container that must be left at the bottom of the page.
     * See CSS 3 orphans, widows properties https://drafts.csswg.org/css-break-3/#widows-orphans
     */
    orphans?: CSSWideKeyword | number;
    /**
     * The CSS outline property is a shorthand property for setting one or more of the individual outline properties outline-style,
     * outline-width and outline-color in a single rule. In most cases the use of this shortcut is preferable and more convenient.
     * Outlines differ from borders in the following ways:
     *      •       Outlines do not take up space, they are drawn above the content.
     *      •       Outlines may be non-rectangular. They are rectangular in Gecko/Firefox.
     *              Internet Explorer attempts to place the smallest contiguous outline around all elements or shapes that are indicated to have an outline.
     *              Opera draws a non-rectangular shape around a construct.
     */
    outline?: CSSWideKeyword | any;
    /**
     * The outline-color property sets the color of the outline of an element. An outline is a line that is drawn around elements, outside the border edge, to make the element stand out.
     */
    "outline-color"?: CSSWideKeyword | any;
    /**
     * The outline-offset property offsets the outline and draw it beyond the border edge.
     */
    "outline-offset"?: CSSWideKeyword | any;
    /**
     * The overflow property controls how extra content exceeding the bounding box of an element is rendered.
     * It can be used in conjunction with an element that has a fixed width and height, to eliminate text-induced page distortion.
     */
    overflow?: CSSWideKeyword | "auto" | "hidden" | "scroll" | "visible";
    /**
     * Specifies the preferred scrolling methods for elements that overflow.
     */
    "overflow-style"?: CSSWideKeyword | any;
    /**
     * Controls how extra content exceeding the x-axis of the bounding box of an element is rendered.
     */
    "overflow-x"?: CSSWideKeyword | "auto" | "hidden" | "scroll" | "visible";
    /**
     * Controls how extra content exceeding the y-axis of the bounding box of an element is rendered.
     */
    "overflow-y"?: CSSWideKeyword | "auto" | "hidden" | "scroll" | "visible";
    /**
     * The padding optional CSS property sets the required padding space on one to four sides of an element.
     * The padding area is the space between an element and its border. Negative values are not allowed but decimal values are permitted.
     * The element size is treated as fixed, and the content of the element shifts toward the center as padding is increased.
     * The padding property is a shorthand to avoid setting each side separately (padding-top, padding-right, padding-bottom, padding-left).
     */
    padding?: CSSWideKeyword | any;
    /**
     * The padding-bottom CSS property of an element sets the padding space required on the bottom of an element.
     * The padding area is the space between the content of the element and its border.
     * Contrary to margin-bottom values, negative values of padding-bottom are invalid.
     */
    "padding-bottom"?: CSSWideKeyword | any;
    /**
     * The padding-left CSS property of an element sets the padding space required on the left side of an element.
     * The padding area is the space between the content of the element and its border.
     * Contrary to margin-left values, negative values of padding-left are invalid.
     */
    "padding-left"?: CSSWideKeyword | any;
    /**
     * The padding-right CSS property of an element sets the padding space required on the right side of an element.
     * The padding area is the space between the content of the element and its border.
     * Contrary to margin-right values, negative values of padding-right are invalid.
     */
    "padding-right"?: CSSWideKeyword | any;
    /**
     * The padding-top CSS property of an element sets the padding space required on the top of an element.
     * The padding area is the space between the content of the element and its border.
     * Contrary to margin-top values, negative values of padding-top are invalid.
     */
    "padding-top"?: CSSWideKeyword | any;
    /**
     * The page-break-after property is supported in all major browsers. With CSS3, page-break-* properties are only aliases of the break-* properties.
     * The CSS3 Fragmentation spec defines breaks for all CSS box fragmentation.
     */
    "page-break-after"?: CSSWideKeyword | any;
    /**
     * The page-break-before property sets the page-breaking behavior before an element.
     * With CSS3, page-break-* properties are only aliases of the break-* properties.
     * The CSS3 Fragmentation spec defines breaks for all CSS box fragmentation.
     */
    "page-break-before"?: CSSWideKeyword | any;
    /**
     * Sets the page-breaking behavior inside an element. With CSS3, page-break-* properties are only aliases of the break-* properties.
     * The CSS3 Fragmentation spec defines breaks for all CSS box fragmentation.
     */
    "page-break-inside"?: CSSWideKeyword | any;
    /**
     * The pause property determines how long a speech media agent should pause before and after presenting an element.
     * It is a shorthand for the pause-before and pause-after properties.
     */
    pause?: CSSWideKeyword | any;
    /**
     * The pause-after property determines how long a speech media agent should pause after presenting an element.
     * It may be replaced by the shorthand property pause, which sets pause time before and after.
     */
    "pause-after"?: CSSWideKeyword | any;
    /**
     * The pause-before property determines how long a speech media agent should pause before presenting an element.
     * It may be replaced by the shorthand property pause, which sets pause time before and after.
     */
    "pause-before"?: CSSWideKeyword | any;
    /**
     * The perspective property defines how far an element is placed from the view on the z-axis, from the screen to the viewer.
     * Perspective defines how an object is viewed. In graphic arts, perspective is the representation on a flat surface of what the viewer's eye would see in a 3D space.
     * (See Wikipedia for more information about graphical perspective and for related illustrations.)
     * The illusion of perspective on a flat surface, such as a computer screen,
     * is created by projecting points on the flat surface as they would appear if the flat surface were a window
     * through which the viewer was looking at the object. In discussion of virtual environments, this flat surface is called a projection plane.
     */
    perspective?: CSSWideKeyword | any;
    /**
     * The perspective-origin property establishes the origin for the perspective property.
     * It effectively sets the X and Y position at which the viewer appears to be looking at the children of the element.
     * When used with perspective, perspective-origin changes the appearance of an object,
     * as if a viewer were looking at it from a different origin.
     * An object appears differently if a viewer is looking directly at it versus looking at it from below, above, or from the side.
     * Thus, the perspective-origin is like a vanishing point.
     * The default value of perspective-origin is 50% 50%.
     * This displays an object as if the viewer's eye were positioned directly at the center of the screen, both top-to-bottom and left-to-right.
     * A value of 0% 0% changes the object as if the viewer was looking toward the top left angle.
     * A value of 100% 100% changes the appearance as if viewed toward the bottom right angle.
     */
    "perspective-origin"?: CSSWideKeyword | any;
    /**
     * The pointer-events property allows you to control whether an element can be the target for the pointing device (e.g, mouse, pen) events.
     */
    "pointer-events"?: CSSWideKeyword | any;
    /**
     * The position property controls the type of positioning used by an element within its parent elements.
     * The effect of the position property depends on a lot of factors, for example the position property of parent elements.
     */
    position?: CSSWideKeyword | "static" | "relative" | "absolute" | "fixed" | "sticky";
    /**
     * Obsolete: unsupported.
     * This property determines whether or not a full-width punctuation mark character should be trimmed if it appears at the beginning of a line,
     * so that its "ink" lines up with the first glyph in the line above and below.
     */
    "punctuation-trim"?: CSSWideKeyword | any;
    /**
     * Sets the type of quotation marks for embedded quotations.
     */
    quotes?: CSSWideKeyword | any;
    /**
     * Controls whether the last region in a chain displays additional 'overset' content according its default overflow property,
     * or if it displays a fragment of content as if it were flowing into a subsequent region.
     */
    "region-fragment"?: CSSWideKeyword | any;
    /**
     * The rest-after property determines how long a speech media agent should pause after presenting an element's main content,
     * before presenting that element's exit cue sound. It may be replaced by the shorthand property rest, which sets rest time before and after.
     */
    "rest-after"?: CSSWideKeyword | any;
    /**
     * The rest-before property determines how long a speech media agent should pause after presenting an intro cue sound for an element,
     * before presenting that element's main content. It may be replaced by the shorthand property rest, which sets rest time before and after.
     */
    "rest-before"?: CSSWideKeyword | any;
    /**
     * Specifies the position an element in relation to the right side of the containing element.
     */
    right?: CSSWideKeyword | any;
    "ruby-align"?: CSSWideKeyword | any;
    "ruby-position"?: CSSWideKeyword | any;
    /**
     * Defines the alpha channel threshold used to extract a shape from an image. Can be thought of as a "minimum opacity" threshold;
     * that is, a value of 0.5 means that the shape will enclose all the pixels that are more than 50% opaque.
     */
    "shape-image-threshold"?: CSSWideKeyword | any;
    /**
     * A future level of CSS Shapes will define a shape-inside property, which will define a shape to wrap content within the element.
     * See Editor's Draft <http://dev.w3.org/csswg/css-shapes/> and CSSWG wiki page on next-level plans <http://wiki.csswg.org/spec/css-shapes>
     */
    "shape-inside"?: CSSWideKeyword | any;
    /**
     * Adds a margin to a shape-outside. In effect, defines a new shape that is the smallest contour around all the points
     * that are the shape-margin distance outward perpendicular to each point on the underlying shape.
     * For points where a perpendicular direction is not defined (e.g., a triangle corner),
     * takes all points on a circle centered at the point and with a radius of the shape-margin distance.
     * This property accepts only non-negative values.
     */
    "shape-margin"?: CSSWideKeyword | any;
    /**
     * Declares a shape around which text should be wrapped, with possible modifications from the shape-margin property.
     * The shape defined by shape-outside and shape-margin changes the geometry of a float element's float area.
     */
    "shape-outside"?: CSSWideKeyword | any;
    /**
     * The speak property determines whether or not a speech synthesizer will read aloud the contents of an element.
     */
    speak?: CSSWideKeyword | any;
    /**
     * The speak-as property determines how the speech synthesizer interprets the content: words as whole words or as a sequence of letters,
     * numbers as a numerical value or a sequence of digits, punctuation as pauses in speech or named punctuation characters.
     */
    "speak-as"?: CSSWideKeyword | any;
    /**
     * SVG: Specifies the opacity of the outline on the current object.
     * See SVG 1.1 https://www.w3.org/TR/SVG/painting.html#StrokeOpacityProperty
     */
    "stroke-opacity"?: CSSWideKeyword | number;
    /**
     * SVG: Specifies the width of the outline on the current object.
     * See SVG 1.1 https://www.w3.org/TR/SVG/painting.html#StrokeWidthProperty
     */
    "stroke-width"?: CSSWideKeyword | CSSPercentage | CSSLength;
    /**
     * The tab-size CSS property is used to customise the width of a tab (U+0009) character.
     */
    "tab-size"?: CSSWideKeyword | any;
    /**
     * The 'table-layout' property controls the algorithm used to lay out the table cells, rows, and columns.
     */
    "table-layout"?: CSSWideKeyword | any;
    /**
     * The text-align CSS property describes how inline content like text is aligned in its parent block element.
     * text-align does not control the alignment of block elements itself, only their inline content.
     */
    "text-align"?: CSSWideKeyword | any;
    /**
     * The text-align-last CSS property describes how the last line of a block element or a line before line break is aligned in its parent block element.
     */
    "text-align-last"?: CSSWideKeyword | any;
    /**
     * The text-decoration CSS property is used to set the text formatting to underline, overline, line-through or blink.
     * underline and overline decorations are positioned under the text, line-through over it.
     */
    "text-decoration"?: CSSWideKeyword | any;
    /**
     * Sets the color of any text decoration, such as underlines, overlines, and strike throughs.
     */
    "text-decoration-color"?: CSSWideKeyword | any;
    /**
     * Sets what kind of line decorations are added to an element, such as underlines, overlines, etc.
     */
    "text-decoration-line"?: CSSWideKeyword | any;
    "text-decoration-line-through"?: CSSWideKeyword | any;
    "text-decoration-none"?: CSSWideKeyword | any;
    "text-decoration-overline"?: CSSWideKeyword | any;
    /**
     * Specifies what parts of an element’s content are skipped over when applying any text decoration.
     */
    "text-decoration-skip"?: CSSWideKeyword | any;
    /**
     * This property specifies the style of the text decoration line drawn on the specified element.
     * The intended meaning for the values are the same as those of the border-style-properties.
     */
    "text-decoration-style"?: CSSWideKeyword | any;
    "text-decoration-underline"?: CSSWideKeyword | any;
    /**
     * The text-emphasis property will apply special emphasis marks to the elements text.
     * Slightly similar to the text-decoration property only that this property can have affect on the line-height.
     * It also is noted that this is shorthand for text-emphasis-style and for text-emphasis-color.
     */
    "text-emphasis"?: CSSWideKeyword | any;
    /**
     * The text-emphasis-color property specifies the foreground color of the emphasis marks.
     */
    "text-emphasis-color"?: CSSWideKeyword | any;
    /**
     * The text-emphasis-style property applies special emphasis marks to an element's text.
     */
    "text-emphasis-style"?: CSSWideKeyword | any;
    /**
     * This property helps determine an inline box's block-progression dimension,
     * derived from the text-height and font-size properties for non-replaced elements,
     * the height or the width for replaced elements, and the stacked block-progression dimension for inline-block elements.
     * The block-progression dimension determines the position of the padding, border and margin for the element.
     */
    "text-height"?: CSSWideKeyword | any;
    /**
     * Specifies the amount of space horizontally that should be left on the first line of the text of an element.
     * This horizontal spacing is at the beginning of the first line and is in respect to the left edge of the containing block box.
     */
    "text-indent"?: CSSWideKeyword | any;
    "text-justify-trim"?: CSSWideKeyword | any;
    "text-kashida-space"?: CSSWideKeyword | any;
    /**
     * The text-line-through property is a shorthand property for text-line-through-style, text-line-through-color and text-line-through-mode.
     * (Considered obsolete; use text-decoration instead.)
     */
    "text-line-through"?: CSSWideKeyword | any;
    /**
     * Specifies the line colors for the line-through text decoration.
     * (Considered obsolete; use text-decoration-color instead.)
     */
    "text-line-through-color"?: CSSWideKeyword | any;
    /**
     * Sets the mode for the line-through text decoration, determining whether the text decoration affects the space characters or not.
     * (Considered obsolete; use text-decoration-skip instead.)
     */
    "text-line-through-mode"?: CSSWideKeyword | any;
    /**
     * Specifies the line style for line-through text decoration.
     * (Considered obsolete; use text-decoration-style instead.)
     */
    "text-line-through-style"?: CSSWideKeyword | any;
    /**
     * Specifies the line width for the line-through text decoration.
     */
    "text-line-through-width"?: CSSWideKeyword | any;
    /**
     * The text-overflow shorthand CSS property determines how overflowed content that is not displayed is signaled to the users.
     * It can be clipped, display an ellipsis ('…', U+2026 HORIZONTAL ELLIPSIS) or a Web author-defined string.
     * It covers the two long-hand properties text-overflow-mode and text-overflow-ellipsis
     */
    "text-overflow"?: CSSWideKeyword | any;
    /**
     * The text-overline property is the shorthand for the text-overline-style, text-overline-width, text-overline-color, and text-overline-mode properties.
     */
    "text-overline"?: CSSWideKeyword | any;
    /**
     * Specifies the line color for the overline text decoration.
     */
    "text-overline-color"?: CSSWideKeyword | any;
    /**
     * Sets the mode for the overline text decoration, determining whether the text decoration affects the space characters or not.
     */
    "text-overline-mode"?: CSSWideKeyword | any;
    /**
     * Specifies the line style for overline text decoration.
     */
    "text-overline-style"?: CSSWideKeyword | any;
    /**
     * Specifies the line width for the overline text decoration.
     */
    "text-overline-width"?: CSSWideKeyword | any;
    /**
     * The text-rendering CSS property provides information to the browser about how to optimize when rendering text.
     * Options are: legibility, speed or geometric precision.
     */
    "text-rendering"?: CSSWideKeyword | any;
    /**
     * Obsolete: unsupported.
     */
    "text-script"?: CSSWideKeyword | any;
    /**
     * The CSS text-shadow property applies one or more drop shadows to the text and <text-decorations> of an element.
     * Each shadow is specified as an offset from the text, along with optional color and blur radius values.
     */
    "text-shadow"?: CSSWideKeyword | any;
    /**
     * This property transforms text for styling purposes. (It has no effect on the underlying content.)
     */
    "text-transform"?: CSSWideKeyword | any;
    /**
     * Unsupported.
     * This property will add a underline position value to the element that has an underline defined.
     */
    "text-underline-position"?: CSSWideKeyword | any;
    /**
     * After review this should be replaced by text-decoration should it not?
     * This property will set the underline style for text with a line value for underline, overline, and line-through.
     */
    "text-underline-style"?: CSSWideKeyword | any;
    /**
     * This property specifies how far an absolutely positioned box's top margin edge is offset below the top edge of the box's containing block.
     * For relatively positioned boxes, the offset is with respect to the top edges of the box itself (i.e., the box is given a position in the normal flow,
     * then offset from that position according to these properties).
     */
    top?: CSSWideKeyword | any;
    /**
     * Determines whether touch input may trigger default behavior supplied by the user agent, such as panning or zooming.
     */
    "touch-action"?: CSSWideKeyword | any;
    /**
     * CSS transforms allow elements styled with CSS to be transformed in two-dimensional or three-dimensional space.
     * Using this property, elements can be translated, rotated, scaled, and skewed. The value list may consist of 2D and/or 3D transform values.
     */
    transform?: CSSWideKeyword | any;
    /**
     * This property defines the origin of the transformation axes relative to the element to which the transformation is applied.
     */
    "transform-origin"?: CSSWideKeyword | any;
    /**
     * This property allows you to define the relative position of the origin of the transformation grid along the z-axis.
     */
    "transform-origin-z"?: CSSWideKeyword | any;
    /**
     * This property specifies how nested elements are rendered in 3D space relative to their parent.
     */
    "transform-style"?: CSSWideKeyword | any;
    /**
     * The transition CSS property is a shorthand property for transition-property, transition-duration, transition-timing-function,
     * and transition-delay. It allows to define the transition between two states of an element.
     */
    transition?: CSSWideKeyword | any;
    /**
     * Defines when the transition will start. A value of ‘0s’ means the transition will execute as soon as the property is changed.
     * Otherwise, the value specifies an offset from the moment the property is changed, and the transition will delay execution by that offset.
     */
    "transition-delay"?: CSSWideKeyword | any;
    /**
     * The 'transition-duration' property specifies the length of time a transition animation takes to complete.
     */
    "transition-duration"?: CSSWideKeyword | any;
    /**
     * The 'transition-property' property specifies the name of the CSS property to which the transition is applied.
     */
    "transition-property"?: CSSWideKeyword | any;
    /**
     * Sets the pace of action within a transition
     */
    "transition-timing-function"?: CSSWideKeyword | any;
    /**
     * The unicode-bidi CSS property specifies the level of embedding with respect to the bidirectional algorithm.
     */
    "unicode-bidi"?: CSSWideKeyword | any;
    /**
     * unicode-range allows you to set a specific range of characters to be downloaded from a font (embedded using @font-face) and made available for use on the current page.
     */
    "unicode-range"?: CSSWideKeyword | any;
    /**
     * This is for all the high level UX stuff.
     */
    "user-focus"?: CSSWideKeyword | any;
    /**
     * For inputing user content
     */
    "user-input"?: CSSWideKeyword | any;
    /**
     * The vertical-align property controls how inline elements or text are vertically aligned compared to the baseline.
     * If this property is used on table-cells it controls the vertical alignment of content of the table cell.
     */
    "vertical-align"?: CSSWideKeyword | any;
    /**
     * The visibility property specifies whether the boxes generated by an element are rendered.
     */
    visibility?: CSSWideKeyword | any;
    /**
     * The voice-balance property sets the apparent position (in stereo sound) of the synthesized voice for spoken media.
     */
    "voice-balance"?: CSSWideKeyword | any;
    /**
     * The voice-duration property allows the author to explicitly set the amount of time it should take a speech synthesizer to read an element's content,
     * for example to allow the speech to be synchronized with other media.
     * With a value of auto (the default) the length of time it takes to read the content is determined by the content itself and the voice-rate property.
     */
    "voice-duration"?: CSSWideKeyword | any;
    /**
     * The voice-family property sets the speaker's voice used by a speech media agent to read an element.
     * The speaker may be specified as a named character (to match a voice option in the speech reading software)
     * or as a generic description of the age and gender of the voice.
     * Similar to the font-family property for visual media,
     * a comma-separated list of fallback options may be given in case the speech reader does not recognize the character name
     * or cannot synthesize the requested combination of generic properties.
     */
    "voice-family"?: CSSWideKeyword | any;
    /**
     * The voice-pitch property sets pitch or tone (high or low) for the synthesized speech when reading an element;
     * the pitch may be specified absolutely or relative to the normal pitch for the voice-family used to read the text.
     */
    "voice-pitch"?: CSSWideKeyword | any;
    /**
     * The voice-range property determines how much variation in pitch or tone will be created by the speech synthesize when reading an element.
     * Emphasized text, grammatical structures and punctuation may all be rendered as changes in pitch,
     * this property determines how strong or obvious those changes are;
     * large ranges are associated with enthusiastic or emotional speech,
     * while small ranges are associated with flat or mechanical speech.
     */
    "voice-range"?: CSSWideKeyword | any;
    /**
     * The voice-rate property sets the speed at which the voice synthesized by a speech media agent will read content.
     */
    "voice-rate"?: CSSWideKeyword | any;
    /**
     * The voice-stress property sets the level of vocal emphasis to be used for synthesized speech reading the element.
     */
    "voice-stress"?: CSSWideKeyword | any;
    /**
     * The voice-volume property sets the volume for spoken content in speech media. It replaces the deprecated volume property.
     */
    "voice-volume"?: CSSWideKeyword | any;
    /**
     * The white-space property controls whether and how white space inside the element is collapsed, and whether lines may wrap at unforced "soft wrap" opportunities.
     */
    "white-space"?: CSSWideKeyword | any;
    /**
     * Obsolete: unsupported.
     */
    "white-space-treatment"?: CSSWideKeyword | any;
    /**
     * In paged media, this property defines the mimimum number of lines
     * that must be left at the top of the second page.
     * See CSS 3 orphans, widows properties https://drafts.csswg.org/css-break-3/#widows-orphans
     */
    widows?: CSSWideKeyword | number;
    /**
     * Specifies the width of the content area of an element. The content area of the element width does not include the padding, border, and margin of the element.
     */
    width?: CSSWideKeyword | any;
    /**
     * The word-break property is often used when there is long generated content that is strung together without and spaces or hyphens to beak apart.
     * A common case of this is when there is a long URL that does not have any hyphens. This case could potentially cause the breaking of the layout as it could extend past the parent element.
     */
    "word-break"?: CSSWideKeyword | any;
    /**
     * The word-spacing CSS property specifies the spacing behavior between "words".
     */
    "word-spacing"?: CSSWideKeyword | any;
    /**
     * An alias of css/properties/overflow-wrap, word-wrap defines whether to break words when the content exceeds the boundaries of its container.
     */
    "word-wrap"?: CSSWideKeyword | any;
    /**
     * Specifies how exclusions affect inline content within block-level elements. Elements lay out their inline content in their content area but wrap around exclusion areas.
     */
    "wrap-flow"?: CSSWideKeyword | any;
    /**
     * Set the value that is used to offset the inner wrap shape from other shapes. Inline content that intersects a shape with this property will be pushed by this shape's margin.
     */
    "wrap-margin"?: CSSWideKeyword | any;
    /**
     * Obsolete and unsupported. Do not use.
     * This CSS property controls the text when it reaches the end of the block in which it is enclosed.
     */
    "wrap-option"?: CSSWideKeyword | any;
    /**
     * writing-mode specifies if lines of text are laid out horizontally or vertically, and the direction which lines of text and blocks progress.
     */
    "writing-mode"?: CSSWideKeyword | any;
    /**
     * The z-index property specifies the z-order of an element and its descendants.
     * When elements overlap, z-order determines which one covers the other.
     * See CSS 2 z-index property https://www.w3.org/TR/CSS2/visuren.html#z-index
     */
    "z-index"?: CSSWideKeyword | "auto" | number;
    /**
     * Sets the initial zoom factor of a document defined by @viewport.
     * See CSS zoom descriptor https://drafts.csswg.org/css-device-adapt/#zoom-desc
     */
    zoom?: CSSWideKeyword | "auto" | number | CSSPercentage;
    [propertyName: string]: any;
  }
  type HTMLAutocapitalize = "off" | "none" | "on" | "sentences" | "words" | "characters";
  type HTMLDir = "ltr" | "rtl" | "auto";
  type HTMLFormEncType = "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain";
  type HTMLFormMethod = "post" | "get" | "dialog";
  type HTMLCrossorigin = "anonymous" | "use-credentials" | "";
  type HTMLReferrerPolicy =
    | "no-referrer"
    | "no-referrer-when-downgrade"
    | "origin"
    | "origin-when-cross-origin"
    | "same-origin"
    | "strict-origin"
    | "strict-origin-when-cross-origin"
    | "unsafe-url";
  type HTMLIframeSandbox =
    | "allow-downloads-without-user-activation"
    | "allow-downloads"
    | "allow-forms"
    | "allow-modals"
    | "allow-orientation-lock"
    | "allow-pointer-lock"
    | "allow-popups"
    | "allow-popups-to-escape-sandbox"
    | "allow-presentation"
    | "allow-same-origin"
    | "allow-scripts"
    | "allow-storage-access-by-user-activation"
    | "allow-top-navigation"
    | "allow-top-navigation-by-user-activation";
  type HTMLLinkAs =
    | "audio"
    | "document"
    | "embed"
    | "fetch"
    | "font"
    | "image"
    | "object"
    | "script"
    | "style"
    | "track"
    | "video"
    | "worker";

  // All the WAI-ARIA 1.1 attributes from https://www.w3.org/TR/wai-aria-1.1/
  interface AriaAttributes {
    /** Identifies the currently active element when DOM focus is on a composite widget, textbox, group, or application. */
    "aria-activedescendant"?: string;
    /** Indicates whether assistive technologies will present all, or only parts of, the changed region based on the change notifications defined by the aria-relevant attribute. */
    "aria-atomic"?: boolean | "false" | "true";
    /**
     * Indicates whether inputting text could trigger display of one or more predictions of the user's intended value for an input and specifies how predictions would be
     * presented if they are made.
     */
    "aria-autocomplete"?: "none" | "inline" | "list" | "both";
    /** Indicates an element is being modified and that assistive technologies MAY want to wait until the modifications are complete before exposing them to the user. */
    "aria-busy"?: boolean | "false" | "true";
    /**
     * Indicates the current "checked" state of checkboxes, radio buttons, and other widgets.
     * @see aria-pressed @see aria-selected.
     */
    "aria-checked"?: boolean | "false" | "mixed" | "true";
    /**
     * Defines the total number of columns in a table, grid, or treegrid.
     * @see aria-colindex.
     */
    "aria-colcount"?: number | string;
    /**
     * Defines an element's column index or position with respect to the total number of columns within a table, grid, or treegrid.
     * @see aria-colcount @see aria-colspan.
     */
    "aria-colindex"?: number | string;
    /**
     * Defines the number of columns spanned by a cell or gridcell within a table, grid, or treegrid.
     * @see aria-colindex @see aria-rowspan.
     */
    "aria-colspan"?: number | string;
    /**
     * Identifies the element (or elements) whose contents or presence are controlled by the current element.
     * @see aria-owns.
     */
    "aria-controls"?: string;
    /** Indicates the element that represents the current item within a container or set of related elements. */
    "aria-current"?: boolean | "false" | "true" | "page" | "step" | "location" | "date" | "time";
    /**
     * Identifies the element (or elements) that describes the object.
     * @see aria-labelledby
     */
    "aria-describedby"?: string;
    /**
     * Identifies the element that provides a detailed, extended description for the object.
     * @see aria-describedby.
     */
    "aria-details"?: string;
    /**
     * Indicates that the element is perceivable but disabled, so it is not editable or otherwise operable.
     * @see aria-hidden @see aria-readonly.
     */
    "aria-disabled"?: boolean | "false" | "true";
    /**
     * Indicates what functions can be performed when a dragged object is released on the drop target.
     * @deprecated in ARIA 1.1
     */
    "aria-dropeffect"?: "none" | "copy" | "execute" | "link" | "move" | "popup";
    /**
     * Identifies the element that provides an error message for the object.
     * @see aria-invalid @see aria-describedby.
     */
    "aria-errormessage"?: string;
    /** Indicates whether the element, or another grouping element it controls, is currently expanded or collapsed. */
    "aria-expanded"?: boolean | "false" | "true";
    /**
     * Identifies the next element (or elements) in an alternate reading order of content which, at the user's discretion,
     * allows assistive technology to override the general default of reading in document source order.
     */
    "aria-flowto"?: string;
    /**
     * Indicates an element's "grabbed" state in a drag-and-drop operation.
     * @deprecated in ARIA 1.1
     */
    "aria-grabbed"?: boolean | "false" | "true";
    /** Indicates the availability and type of interactive popup element, such as menu or dialog, that can be triggered by an element. */
    "aria-haspopup"?: boolean | "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog";
    /**
     * Indicates whether the element is exposed to an accessibility API.
     * @see aria-disabled.
     */
    "aria-hidden"?: boolean | "false" | "true";
    /**
     * Indicates the entered value does not conform to the format expected by the application.
     * @see aria-errormessage.
     */
    "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
    /** Indicates keyboard shortcuts that an author has implemented to activate or give focus to an element. */
    "aria-keyshortcuts"?: string;
    /**
     * Defines a string value that labels the current element.
     * @see aria-labelledby.
     */
    "aria-label"?: string;
    /**
     * Identifies the element (or elements) that labels the current element.
     * @see aria-describedby.
     */
    "aria-labelledby"?: string;
    /** Defines the hierarchical level of an element within a structure. */
    "aria-level"?: number | string;
    /** Indicates that an element will be updated, and describes the types of updates the user agents, assistive technologies, and user can expect from the live region. */
    "aria-live"?: "off" | "assertive" | "polite";
    /** Indicates whether an element is modal when displayed. */
    "aria-modal"?: boolean | "false" | "true";
    /** Indicates whether a text box accepts multiple lines of input or only a single line. */
    "aria-multiline"?: boolean | "false" | "true";
    /** Indicates that the user may select more than one item from the current selectable descendants. */
    "aria-multiselectable"?: boolean | "false" | "true";
    /** Indicates whether the element's orientation is horizontal, vertical, or unknown/ambiguous. */
    "aria-orientation"?: "horizontal" | "vertical";
    /**
     * Identifies an element (or elements) in order to define a visual, functional, or contextual parent/child relationship
     * between DOM elements where the DOM hierarchy cannot be used to represent the relationship.
     * @see aria-controls.
     */
    "aria-owns"?: string;
    /**
     * Defines a short hint (a word or short phrase) intended to aid the user with data entry when the control has no value.
     * A hint could be a sample value or a brief description of the expected format.
     */
    "aria-placeholder"?: string;
    /**
     * Defines an element's number or position in the current set of listitems or treeitems. Not required if all elements in the set are present in the DOM.
     * @see aria-setsize.
     */
    "aria-posinset"?: number | string;
    /**
     * Indicates the current "pressed" state of toggle buttons.
     * @see aria-checked @see aria-selected.
     */
    "aria-pressed"?: boolean | "false" | "mixed" | "true";
    /**
     * Indicates that the element is not editable, but is otherwise operable.
     * @see aria-disabled.
     */
    "aria-readonly"?: boolean | "false" | "true";
    /**
     * Indicates what notifications the user agent will trigger when the accessibility tree within a live region is modified.
     * @see aria-atomic.
     */
    "aria-relevant"?:
      | "additions"
      | "additions removals"
      | "additions text"
      | "all"
      | "removals"
      | "removals additions"
      | "removals text"
      | "text"
      | "text additions"
      | "text removals";
    /** Indicates that user input is required on the element before a form may be submitted. */
    "aria-required"?: boolean | "false" | "true";
    /** Defines a human-readable, author-localized description for the role of an element. */
    "aria-roledescription"?: string;
    /**
     * Defines the total number of rows in a table, grid, or treegrid.
     * @see aria-rowindex.
     */
    "aria-rowcount"?: number | string;
    /**
     * Defines an element's row index or position with respect to the total number of rows within a table, grid, or treegrid.
     * @see aria-rowcount @see aria-rowspan.
     */
    "aria-rowindex"?: number | string;
    /**
     * Defines the number of rows spanned by a cell or gridcell within a table, grid, or treegrid.
     * @see aria-rowindex @see aria-colspan.
     */
    "aria-rowspan"?: number | string;
    /**
     * Indicates the current "selected" state of various widgets.
     * @see aria-checked @see aria-pressed.
     */
    "aria-selected"?: boolean | "false" | "true";
    /**
     * Defines the number of items in the current set of listitems or treeitems. Not required if all elements in the set are present in the DOM.
     * @see aria-posinset.
     */
    "aria-setsize"?: number | string;
    /** Indicates if items in a table or grid are sorted in ascending or descending order. */
    "aria-sort"?: "none" | "ascending" | "descending" | "other";
    /** Defines the maximum allowed value for a range widget. */
    "aria-valuemax"?: number | string;
    /** Defines the minimum allowed value for a range widget. */
    "aria-valuemin"?: number | string;
    /**
     * Defines the current value for a range widget.
     * @see aria-valuetext.
     */
    "aria-valuenow"?: number | string;
    /** Defines the human readable text alternative of aria-valuenow for a range widget. */
    "aria-valuetext"?: string;
  }

  interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    accessKey?: FunctionMaybe<string>;
    class?: FunctionMaybe<string>;
    contenteditable?: FunctionMaybe<boolean | "inherit">;
    contextmenu?: FunctionMaybe<string>;
    dir?: FunctionMaybe<HTMLDir>;
    draggable?: FunctionMaybe<boolean>;
    hidden?: FunctionMaybe<boolean>;
    id?: FunctionMaybe<string>;
    lang?: FunctionMaybe<string>;
    spellcheck?: FunctionMaybe<boolean>;
    style?: FunctionMaybe<CSSProperties | string>;
    tabindex?: FunctionMaybe<number | string>;
    title?: FunctionMaybe<string>;
    translate?: FunctionMaybe<"yes" | "no">;
    about?: FunctionMaybe<string>;
    datatype?: FunctionMaybe<string>;
    inlist?: FunctionMaybe<any>;
    prefix?: FunctionMaybe<string>;
    property?: FunctionMaybe<string>;
    resource?: FunctionMaybe<string>;
    typeof?: FunctionMaybe<string>;
    vocab?: FunctionMaybe<string>;
    role?: FunctionMaybe<
      | "alert"
      | "alertdialog"
      | "application"
      | "article"
      | "banner"
      | "button"
      | "cell"
      | "checkbox"
      | "columnheader"
      | "combobox"
      | "complementary"
      | "contentinfo"
      | "definition"
      | "dialog"
      | "directory"
      | "document"
      | "feed"
      | "figure"
      | "form"
      | "grid"
      | "gridcell"
      | "group"
      | "heading"
      | "img"
      | "link"
      | "list"
      | "listbox"
      | "listitem"
      | "log"
      | "main"
      | "marquee"
      | "math"
      | "menu"
      | "menubar"
      | "menuitem"
      | "menuitemcheckbox"
      | "menuitemradio"
      | "meter"
      | "navigation"
      | "none"
      | "note"
      | "option"
      | "presentation"
      | "progressbar"
      | "radio"
      | "radiogroup"
      | "region"
      | "row"
      | "rowgroup"
      | "rowheader"
      | "scrollbar"
      | "search"
      | "searchbox"
      | "separator"
      | "slider"
      | "spinbutton"
      | "status"
      | "switch"
      | "tab"
      | "table"
      | "tablist"
      | "tabpanel"
      | "term"
      | "textbox"
      | "timer"
      | "toolbar"
      | "tooltip"
      | "tree"
      | "treegrid"
      | "treeitem">;
    autocapitalize?: FunctionMaybe<HTMLAutocapitalize>;
    slot?: FunctionMaybe<string>;
    color?: FunctionMaybe<string>;
    itemprop?: FunctionMaybe<string>;
    itemscope?: FunctionMaybe<boolean>;
    itemtype?: FunctionMaybe<string>;
    itemid?: FunctionMaybe<string>;
    itemref?: FunctionMaybe<string>;
    part?: FunctionMaybe<string>;
    exportparts?: FunctionMaybe<string>;
    inputmode?: FunctionMaybe<"none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search">;
    contentEditable?: FunctionMaybe<boolean | "inherit">;
    contextMenu?: FunctionMaybe<string>;
    tabIndex?: FunctionMaybe<number | string>;
    autoCapitalize?: FunctionMaybe<HTMLAutocapitalize>;
    itemProp?: FunctionMaybe<string>;
    itemScope?: FunctionMaybe<boolean>;
    itemType?: FunctionMaybe<string>;
    itemId?: FunctionMaybe<string>;
    itemRef?: FunctionMaybe<string>;
    exportParts?: FunctionMaybe<string>;
    inputMode?: FunctionMaybe<"none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search">;
  }
  interface AnchorHTMLAttributes<T> extends HTMLAttributes<T> {
    download?: FunctionMaybe<any>;
    href?: FunctionMaybe<string>;
    hreflang?: FunctionMaybe<string>;
    media?: FunctionMaybe<string>;
    ping?: FunctionMaybe<string>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy>;
    rel?: FunctionMaybe<string>;
    target?: FunctionMaybe<string>;
    type?: FunctionMaybe<string>;
    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy>;
  }
  interface AudioHTMLAttributes<T> extends MediaHTMLAttributes<T> {}
  interface AreaHTMLAttributes<T> extends HTMLAttributes<T> {
    alt?: FunctionMaybe<string>;
    coords?: FunctionMaybe<string>;
    download?: FunctionMaybe<any>;
    href?: FunctionMaybe<string>;
    hreflang?: FunctionMaybe<string>;
    ping?: FunctionMaybe<string>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy>;
    rel?: FunctionMaybe<string>;
    shape?: FunctionMaybe<"rect" | "circle" | "poly" | "default">;
    target?: FunctionMaybe<string>;
    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy>;
  }
  interface BaseHTMLAttributes<T> extends HTMLAttributes<T> {
    href?: FunctionMaybe<string>;
    target?: FunctionMaybe<string>;
  }
  interface BlockquoteHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: FunctionMaybe<string>;
  }
  interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
    autofocus?: FunctionMaybe<boolean>;
    disabled?: FunctionMaybe<boolean>;
    form?: FunctionMaybe<string>;
    formaction?: FunctionMaybe<string>;
    formenctype?: FunctionMaybe<HTMLFormEncType>;
    formmethod?: FunctionMaybe<HTMLFormMethod>;
    formnovalidate?: FunctionMaybe<boolean>;
    formtarget?: FunctionMaybe<string>;
    name?: FunctionMaybe<string>;
    type?: FunctionMaybe<"submit" | "reset" | "button">;
    value?: FunctionMaybe<string>;
    formAction?: FunctionMaybe<string>;
    formEnctype?: FunctionMaybe<HTMLFormEncType>;
    formMethod?: FunctionMaybe<HTMLFormMethod>;
    formNoValidate?: FunctionMaybe<boolean>;
    formTarget?: FunctionMaybe<string>;
  }
  interface CanvasHTMLAttributes<T> extends HTMLAttributes<T> {
    width?: FunctionMaybe<number | string>;
    height?: FunctionMaybe<number | string>;
  }
  interface ColHTMLAttributes<T> extends HTMLAttributes<T> {
    span?: FunctionMaybe<number | string>;
    width?: FunctionMaybe<number | string>;
  }
  interface ColgroupHTMLAttributes<T> extends HTMLAttributes<T> {
    span?: FunctionMaybe<number | string>;
  }
  interface DataHTMLAttributes<T> extends HTMLAttributes<T> {
    value?: FunctionMaybe<string | string[] | number>;
  }
  interface DetailsHtmlAttributes<T> extends HTMLAttributes<T> {
    open?: FunctionMaybe<boolean>;
    onToggle?: EventHandlerUnion<T, Event>;
    ontoggle?: EventHandlerUnion<T, Event>;
  }
  interface DialogHtmlAttributes<T> extends HTMLAttributes<T> {
    open?: FunctionMaybe<boolean>;
  }
  interface EmbedHTMLAttributes<T> extends HTMLAttributes<T> {
    height?: FunctionMaybe<number | string>;
    src?: FunctionMaybe<string>;
    type?: FunctionMaybe<string>;
    width?: FunctionMaybe<number | string>;
  }
  interface FieldsetHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: FunctionMaybe<boolean>;
    form?: FunctionMaybe<string>;
    name?: FunctionMaybe<string>;
  }
  interface FormHTMLAttributes<T> extends HTMLAttributes<T> {
    acceptcharset?: FunctionMaybe<string>;
    action?: FunctionMaybe<string>;
    autocomplete?: FunctionMaybe<string>;
    encoding?: FunctionMaybe<HTMLFormEncType>;
    enctype?: FunctionMaybe<HTMLFormEncType>;
    method?: FunctionMaybe<HTMLFormMethod>;
    name?: FunctionMaybe<string>;
    novalidate?: FunctionMaybe<boolean>;
    target?: FunctionMaybe<string>;
    acceptCharset?: FunctionMaybe<string>;
    noValidate?: FunctionMaybe<boolean>;
  }
  interface IframeHTMLAttributes<T> extends HTMLAttributes<T> {
    allow?: FunctionMaybe<string>;
    allowfullscreen?: FunctionMaybe<boolean>;
    height?: FunctionMaybe<number | string>;
    name?: FunctionMaybe<string>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy>;
    sandbox?: HTMLIframeSandbox | string;
    src?: FunctionMaybe<string>;
    srcdoc?: FunctionMaybe<string>;
    width?: FunctionMaybe<number | string>;
    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy>;
  }
  interface ImgHTMLAttributes<T> extends HTMLAttributes<T> {
    alt?: FunctionMaybe<string>;
    crossorigin?: FunctionMaybe<HTMLCrossorigin>;
    decoding?: FunctionMaybe<"sync" | "async" | "auto">;
    height?: FunctionMaybe<number | string>;
    ismap?: FunctionMaybe<boolean>;
    isMap?: FunctionMaybe<boolean>;
    loading?: FunctionMaybe<"eager" | "lazy">;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy>;
    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy>;
    sizes?: FunctionMaybe<string>;
    src?: FunctionMaybe<string>;
    srcset?: FunctionMaybe<string>;
    srcSet?: FunctionMaybe<string>;
    usemap?: FunctionMaybe<string>;
    useMap?: FunctionMaybe<string>;
    width?: FunctionMaybe<number | string>;
    crossOrigin?: FunctionMaybe<HTMLCrossorigin>;
  }
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    accept?: FunctionMaybe<string>;
    alt?: FunctionMaybe<string>;
    autocomplete?: FunctionMaybe<string>;
    autofocus?: FunctionMaybe<boolean>;
    capture?: FunctionMaybe<boolean | string>;
    checked?: FunctionMaybe<boolean>;
    crossorigin?: FunctionMaybe<HTMLCrossorigin>;
    disabled?: FunctionMaybe<boolean>;
    form?: FunctionMaybe<string>;
    formaction?: FunctionMaybe<string>;
    formenctype?: FunctionMaybe<HTMLFormEncType>;
    formmethod?: FunctionMaybe<HTMLFormMethod>;
    formnovalidate?: FunctionMaybe<boolean>;
    formtarget?: FunctionMaybe<string>;
    height?: FunctionMaybe<number | string>;
    list?: FunctionMaybe<string>;
    max?: FunctionMaybe<number | string>;
    maxlength?: FunctionMaybe<number | string>;
    min?: FunctionMaybe<number | string>;
    minlength?: FunctionMaybe<number | string>;
    multiple?: FunctionMaybe<boolean>;
    name?: FunctionMaybe<string>;
    pattern?: FunctionMaybe<string>;
    placeholder?: FunctionMaybe<string>;
    readonly?: FunctionMaybe<boolean>;
    required?: FunctionMaybe<boolean>;
    size?: FunctionMaybe<number | string>;
    src?: FunctionMaybe<string>;
    step?: FunctionMaybe<number | string>;
    type?: FunctionMaybe<string>;
    value?: FunctionMaybe<string | string[] | number>;
    width?: FunctionMaybe<number | string>;
    crossOrigin?: FunctionMaybe<HTMLCrossorigin>;
    formAction?: FunctionMaybe<string>;
    formEnctype?: FunctionMaybe<HTMLFormEncType>;
    formMethod?: FunctionMaybe<HTMLFormMethod>;
    formNoValidate?: FunctionMaybe<boolean>;
    formTarget?: FunctionMaybe<string>;
    maxLength?: FunctionMaybe<number | string>;
    minLength?: FunctionMaybe<number | string>;
    readOnly?: FunctionMaybe<boolean>;
  }
  interface InsHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: FunctionMaybe<string>;
    dateTime?: FunctionMaybe<string>;
  }
  interface KeygenHTMLAttributes<T> extends HTMLAttributes<T> {
    autofocus?: FunctionMaybe<boolean>;
    challenge?: FunctionMaybe<string>;
    disabled?: FunctionMaybe<boolean>;
    form?: FunctionMaybe<string>;
    keytype?: FunctionMaybe<string>;
    keyparams?: FunctionMaybe<string>;
    name?: FunctionMaybe<string>;
  }
  interface LabelHTMLAttributes<T> extends HTMLAttributes<T> {
    for?: FunctionMaybe<string>;
    form?: FunctionMaybe<string>;
  }
  interface LiHTMLAttributes<T> extends HTMLAttributes<T> {
    value?: FunctionMaybe<number | string>;
  }
  interface LinkHTMLAttributes<T> extends HTMLAttributes<T> {
    as?: FunctionMaybe<HTMLLinkAs>;
    crossorigin?: FunctionMaybe<HTMLCrossorigin>;
    disabled?: FunctionMaybe<boolean>;
    href?: FunctionMaybe<string>;
    hreflang?: FunctionMaybe<string>;
    integrity?: FunctionMaybe<string>;
    media?: FunctionMaybe<string>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy>;
    rel?: FunctionMaybe<string>;
    sizes?: FunctionMaybe<string>;
    type?: FunctionMaybe<string>;
    crossOrigin?: FunctionMaybe<HTMLCrossorigin>;
    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy>;
  }
  interface MapHTMLAttributes<T> extends HTMLAttributes<T> {
    name?: FunctionMaybe<string>;
  }
  interface MediaHTMLAttributes<T> extends HTMLAttributes<T> {
    autoplay?: FunctionMaybe<boolean>;
    controls?: FunctionMaybe<boolean>;
    crossorigin?: FunctionMaybe<HTMLCrossorigin>;
    loop?: FunctionMaybe<boolean>;
    mediagroup?: FunctionMaybe<string>;
    muted?: FunctionMaybe<boolean>;
    preload?: FunctionMaybe<"none" | "metadata" | "auto" | "">;
    src?: FunctionMaybe<string>;
    crossOrigin?: FunctionMaybe<HTMLCrossorigin>;
    mediaGroup?: FunctionMaybe<string>;
  }
  interface MenuHTMLAttributes<T> extends HTMLAttributes<T> {
    label?: FunctionMaybe<string>;
    type?: FunctionMaybe<"context" | "toolbar">;
  }
  interface MetaHTMLAttributes<T> extends HTMLAttributes<T> {
    charset?: FunctionMaybe<string>;
    content?: FunctionMaybe<string>;
    httpequiv?: FunctionMaybe<string>;
    name?: FunctionMaybe<string>;
    httpEquiv?: FunctionMaybe<string>;
  }
  interface MeterHTMLAttributes<T> extends HTMLAttributes<T> {
    form?: FunctionMaybe<string>;
    high?: FunctionMaybe<number | string>;
    low?: FunctionMaybe<number | string>;
    max?: FunctionMaybe<number | string>;
    min?: FunctionMaybe<number | string>;
    optimum?: FunctionMaybe<number | string>;
    value?: FunctionMaybe<string | string[] | number>;
  }
  interface QuoteHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: FunctionMaybe<string>;
  }
  interface ObjectHTMLAttributes<T> extends HTMLAttributes<T> {
    data?: FunctionMaybe<string>;
    form?: FunctionMaybe<string>;
    height?: FunctionMaybe<number | string>;
    name?: FunctionMaybe<string>;
    type?: FunctionMaybe<string>;
    usemap?: FunctionMaybe<string>;
    width?: FunctionMaybe<number | string>;
    useMap?: FunctionMaybe<string>;
  }
  interface OlHTMLAttributes<T> extends HTMLAttributes<T> {
    reversed?: FunctionMaybe<boolean>;
    start?: FunctionMaybe<number | string>;
    type?: FunctionMaybe<"1" | "a" | "A" | "i" | "I">;
  }
  interface OptgroupHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: FunctionMaybe<boolean>;
    label?: FunctionMaybe<string>;
  }
  interface OptionHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: FunctionMaybe<boolean>;
    label?: FunctionMaybe<string>;
    selected?: FunctionMaybe<boolean>;
    value?: FunctionMaybe<string | string[] | number>;
  }
  interface OutputHTMLAttributes<T> extends HTMLAttributes<T> {
    form?: FunctionMaybe<string>;
    for?: FunctionMaybe<string>;
    name?: FunctionMaybe<string>;
  }
  interface ParamHTMLAttributes<T> extends HTMLAttributes<T> {
    name?: FunctionMaybe<string>;
    value?: FunctionMaybe<string | string[] | number>;
  }
  interface ProgressHTMLAttributes<T> extends HTMLAttributes<T> {
    max?: FunctionMaybe<number | string>;
    value?: FunctionMaybe<string | string[] | number>;
  }
  interface ScriptHTMLAttributes<T> extends HTMLAttributes<T> {
    async?: FunctionMaybe<boolean>;
    charset?: FunctionMaybe<string>;
    crossorigin?: FunctionMaybe<HTMLCrossorigin>;
    defer?: FunctionMaybe<boolean>;
    integrity?: FunctionMaybe<string>;
    nomodule?: FunctionMaybe<boolean>;
    nonce?: FunctionMaybe<string>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy>;
    src?: FunctionMaybe<string>;
    type?: FunctionMaybe<string>;
    crossOrigin?: FunctionMaybe<HTMLCrossorigin>;
    noModule?: FunctionMaybe<boolean>;
    referrerPolicy?: FunctionMaybe<HTMLReferrerPolicy>;
  }
  interface SelectHTMLAttributes<T> extends HTMLAttributes<T> {
    autocomplete?: FunctionMaybe<string>;
    autofocus?: FunctionMaybe<boolean>;
    disabled?: FunctionMaybe<boolean>;
    form?: FunctionMaybe<string>;
    multiple?: FunctionMaybe<boolean>;
    name?: FunctionMaybe<string>;
    required?: FunctionMaybe<boolean>;
    size?: FunctionMaybe<number | string>;
    value?: FunctionMaybe<string | string[] | number>;
  }
  interface HTMLSlotElementAttributes<T = HTMLSlotElement> extends HTMLAttributes<T> {
    name?: FunctionMaybe<string>;
  }
  interface SourceHTMLAttributes<T> extends HTMLAttributes<T> {
    media?: FunctionMaybe<string>;
    sizes?: FunctionMaybe<string>;
    src?: FunctionMaybe<string>;
    srcset?: FunctionMaybe<string>;
    type?: FunctionMaybe<string>;
  }
  interface StyleHTMLAttributes<T> extends HTMLAttributes<T> {
    media?: FunctionMaybe<string>;
    nonce?: FunctionMaybe<string>;
    scoped?: FunctionMaybe<boolean>;
    type?: FunctionMaybe<string>;
  }
  interface TdHTMLAttributes<T> extends HTMLAttributes<T> {
    colspan?: FunctionMaybe<number | string>;
    headers?: FunctionMaybe<string>;
    rowspan?: FunctionMaybe<number | string>;
    colSpan?: FunctionMaybe<number | string>;
    rowSpan?: FunctionMaybe<number | string>;
  }
  interface TextareaHTMLAttributes<T> extends HTMLAttributes<T> {
    autocomplete?: FunctionMaybe<string>;
    autofocus?: FunctionMaybe<boolean>;
    cols?: FunctionMaybe<number | string>;
    dirname?: FunctionMaybe<string>;
    disabled?: FunctionMaybe<boolean>;
    form?: FunctionMaybe<string>;
    maxlength?: FunctionMaybe<number | string>;
    minlength?: FunctionMaybe<number | string>;
    name?: FunctionMaybe<string>;
    placeholder?: FunctionMaybe<string>;
    readonly?: FunctionMaybe<boolean>;
    required?: FunctionMaybe<boolean>;
    rows?: FunctionMaybe<number | string>;
    value?: FunctionMaybe<string | string[] | number>;
    wrap?: FunctionMaybe<"hard" | "soft" | "off">;
    maxLength?: FunctionMaybe<number | string>;
    minLength?: FunctionMaybe<number | string>;
    readOnly?: FunctionMaybe<boolean>;
  }
  interface ThHTMLAttributes<T> extends HTMLAttributes<T> {
    colspan?: FunctionMaybe<number | string>;
    headers?: FunctionMaybe<string>;
    rowspan?: FunctionMaybe<number | string>;
    colSpan?: FunctionMaybe<number | string>;
    rowSpan?: FunctionMaybe<number | string>;
    scope?: FunctionMaybe<'col' | 'row' | 'rowgroup' | 'colgroup'>;
  }
  interface TimeHTMLAttributes<T> extends HTMLAttributes<T> {
    datetime?: FunctionMaybe<string>;
    dateTime?: FunctionMaybe<string>;
  }
  interface TrackHTMLAttributes<T> extends HTMLAttributes<T> {
    default?: FunctionMaybe<boolean>;
    kind?: FunctionMaybe<"subtitles" | "captions" | "descriptions" | "chapters" | "metadata">;
    label?: FunctionMaybe<string>;
    src?: FunctionMaybe<string>;
    srclang?: FunctionMaybe<string>;
  }
  interface VideoHTMLAttributes<T> extends MediaHTMLAttributes<T> {
    height?: FunctionMaybe<number | string>;
    playsinline?: FunctionMaybe<boolean>;
    poster?: FunctionMaybe<string>;
    width?: FunctionMaybe<number | string>;
  }
  type SVGPreserveAspectRatio =
    | "none"
    | "xMinYMin"
    | "xMidYMin"
    | "xMaxYMin"
    | "xMinYMid"
    | "xMidYMid"
    | "xMaxYMid"
    | "xMinYMax"
    | "xMidYMax"
    | "xMaxYMax"
    | "xMinYMin meet"
    | "xMidYMin meet"
    | "xMaxYMin meet"
    | "xMinYMid meet"
    | "xMidYMid meet"
    | "xMaxYMid meet"
    | "xMinYMax meet"
    | "xMidYMax meet"
    | "xMaxYMax meet"
    | "xMinYMin slice"
    | "xMidYMin slice"
    | "xMaxYMin slice"
    | "xMinYMid slice"
    | "xMidYMid slice"
    | "xMaxYMid slice"
    | "xMinYMax slice"
    | "xMidYMax slice"
    | "xMaxYMax slice";
  type ImagePreserveAspectRatio =
    | SVGPreserveAspectRatio
    | "defer none"
    | "defer xMinYMin"
    | "defer xMidYMin"
    | "defer xMaxYMin"
    | "defer xMinYMid"
    | "defer xMidYMid"
    | "defer xMaxYMid"
    | "defer xMinYMax"
    | "defer xMidYMax"
    | "defer xMaxYMax"
    | "defer xMinYMin meet"
    | "defer xMidYMin meet"
    | "defer xMaxYMin meet"
    | "defer xMinYMid meet"
    | "defer xMidYMid meet"
    | "defer xMaxYMid meet"
    | "defer xMinYMax meet"
    | "defer xMidYMax meet"
    | "defer xMaxYMax meet"
    | "defer xMinYMin slice"
    | "defer xMidYMin slice"
    | "defer xMaxYMin slice"
    | "defer xMinYMid slice"
    | "defer xMidYMid slice"
    | "defer xMaxYMid slice"
    | "defer xMinYMax slice"
    | "defer xMidYMax slice"
    | "defer xMaxYMax slice";
  type SVGUnits = "userSpaceOnUse" | "objectBoundingBox";
  interface CoreSVGAttributes<T> extends DOMAttributes<T> {
    id?: FunctionMaybe<string>;
    lang?: FunctionMaybe<string>;
    tabIndex?: FunctionMaybe<number | string>;
    tabindex?: FunctionMaybe<number | string>;
  }
  interface StylableSVGAttributes {
    class?: FunctionMaybe<string>;
    style?: FunctionMaybe<CSSProperties | string>;
  }
  interface TransformableSVGAttributes {
    transform?: FunctionMaybe<string>;
  }
  interface ConditionalProcessingSVGAttributes {
    requiredExtensions?: FunctionMaybe<string>;
    requiredFeatures?: FunctionMaybe<string>;
    systemLanguage?: FunctionMaybe<string>;
  }
  interface ExternalResourceSVGAttributes {
    externalResourcesRequired?: FunctionMaybe<"true" | "false">;
  }
  interface AnimationTimingSVGAttributes {
    begin?: FunctionMaybe<string>;
    dur?: FunctionMaybe<string>;
    end?: FunctionMaybe<string>;
    min?: FunctionMaybe<string>;
    max?: FunctionMaybe<string>;
    restart?: FunctionMaybe<"always" | "whenNotActive" | "never">;
    repeatCount?: FunctionMaybe<number | "indefinite">;
    repeatDur?: FunctionMaybe<string>;
    fill?: FunctionMaybe<"freeze" | "remove">;
  }
  interface AnimationValueSVGAttributes {
    calcMode?: FunctionMaybe<"discrete" | "linear" | "paced" | "spline">;
    values?: FunctionMaybe<string>;
    keyTimes?: FunctionMaybe<string>;
    keySplines?: FunctionMaybe<string>;
    from?: FunctionMaybe<number | string>;
    to?: FunctionMaybe<number | string>;
    by?: FunctionMaybe<number | string>;
  }
  interface AnimationAdditionSVGAttributes {
    attributeName?: FunctionMaybe<string>;
    additive?: FunctionMaybe<"replace" | "sum">;
    accumulate?: FunctionMaybe<"none" | "sum">;
  }
  interface AnimationAttributeTargetSVGAttributes {
    attributeName?: FunctionMaybe<string>;
    attributeType?: FunctionMaybe<"CSS" | "XML" | "auto">;
  }
  interface PresentationSVGAttributes {
    "alignment-baseline"?:
      | "auto"
      | "baseline"
      | "before-edge"
      | "text-before-edge"
      | "middle"
      | "central"
      | "after-edge"
      | "text-after-edge"
      | "ideographic"
      | "alphabetic"
      | "hanging"
      | "mathematical"
      | "inherit";
    "baseline-shift"?: FunctionMaybe<number | string>;
    clip?: FunctionMaybe<string>;
    "clip-path"?: FunctionMaybe<string>;
    "clip-rule"?: "nonzero" | "evenodd" | "inherit";
    color?: FunctionMaybe<string>;
    "color-interpolation"?: "auto" | "sRGB" | "linearRGB" | "inherit";
    "color-interpolation-filters"?: "auto" | "sRGB" | "linearRGB" | "inherit";
    "color-profile"?: FunctionMaybe<string>;
    "color-rendering"?: "auto" | "optimizeSpeed" | "optimizeQuality" | "inherit";
    cursor?: FunctionMaybe<string>;
    direction?: "ltr" | "rtl" | "inherit";
    display?: FunctionMaybe<string>;
    "dominant-baseline"?:
      | "auto"
      | "text-bottom"
      | "alphabetic"
      | "ideographic"
      | "middle"
      | "central"
      | "mathematical"
      | "hanging"
      | "text-top"
      | "inherit";
    "enable-background"?: FunctionMaybe<string>;
    fill?: FunctionMaybe<string>;
    "fill-opacity"?: FunctionMaybe<number | string | "inherit">;
    "fill-rule"?: FunctionMaybe<"nonzero" | "evenodd" | "inherit">;
    filter?: FunctionMaybe<string>;
    "flood-color"?: FunctionMaybe<string>;
    "flood-opacity"?: FunctionMaybe<number | string | "inherit">;
    "font-family"?: FunctionMaybe<string>;
    "font-size"?: FunctionMaybe<string>;
    "font-size-adjust"?: FunctionMaybe<number | string>;
    "font-stretch"?: FunctionMaybe<string>;
    "font-style"?: FunctionMaybe<"normal" | "italic" | "oblique" | "inherit">;
    "font-variant"?: FunctionMaybe<string>;
    "font-weight"?: FunctionMaybe<number | string>;
    "glyph-orientation-horizontal"?: FunctionMaybe<string>;
    "glyph-orientation-vertical"?: FunctionMaybe<string>;
    "image-rendering"?: FunctionMaybe<"auto" | "optimizeQuality" | "optimizeSpeed" | "inherit">;
    kerning?: FunctionMaybe<string>;
    "letter-spacing"?: FunctionMaybe<number | string>;
    "lighting-color"?: FunctionMaybe<string>;
    "marker-end"?: FunctionMaybe<string>;
    "marker-mid"?: FunctionMaybe<string>;
    "marker-start"?: FunctionMaybe<string>;
    mask?: FunctionMaybe<string>;
    opacity?: FunctionMaybe<number | string | "inherit">;
    overflow?: FunctionMaybe<"visible" | "hidden" | "scroll" | "auto" | "inherit">;
    "pointer-events"?: FunctionMaybe<
      | "bounding-box"
      | "visiblePainted"
      | "visibleFill"
      | "visibleStroke"
      | "visible"
      | "painted"
      | "color"
      | "fill"
      | "stroke"
      | "all"
      | "none"
      | "inherit">;
    "shape-rendering"?: FunctionMaybe<"auto" | "optimizeSpeed" | "crispEdges" | "geometricPrecision" | "inherit">;
    "stop-color"?: FunctionMaybe<string>;
    "stop-opacity"?: FunctionMaybe<number | string | "inherit">;
    stroke?: FunctionMaybe<string>;
    "stroke-dasharray"?: FunctionMaybe<string>;
    "stroke-dashoffset"?: FunctionMaybe<number | string>;
    "stroke-linecap"?: FunctionMaybe<"butt" | "round" | "square" | "inherit">;
    "stroke-linejoin"?: FunctionMaybe<"arcs" | "bevel" | "miter" | "miter-clip" | "round" | "inherit">;
    "stroke-miterlimit"?: FunctionMaybe<number | string | "inherit">;
    "stroke-opacity"?: FunctionMaybe<number | string | "inherit">;
    "stroke-width"?: FunctionMaybe<number | string>;
    "text-anchor"?: FunctionMaybe<"start" | "middle" | "end" | "inherit">;
    "text-decoration"?: FunctionMaybe<"none" | "underline" | "overline" | "line-through" | "blink" | "inherit">;
    "text-rendering"?: FunctionMaybe<
      | "auto"
      | "optimizeSpeed"
      | "optimizeLegibility"
      | "geometricPrecision"
      | "inherit">;
    "unicode-bidi"?: FunctionMaybe<string>;
    visibility?: FunctionMaybe<"visible" | "hidden" | "collapse" | "inherit">;
    "word-spacing"?: FunctionMaybe<number | string>;
    "writing-mode"?: FunctionMaybe<"lr-tb" | "rl-tb" | "tb-rl" | "lr" | "rl" | "tb" | "inherit">;
  }
  interface AnimationElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      ConditionalProcessingSVGAttributes {}
  interface ContainerElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "clip-path"
        | "mask"
        | "cursor"
        | "opacity"
        | "filter"
        | "enable-background"
        | "color-interpolation"
        | "color-rendering"
      > {}
  interface FilterPrimitiveElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "color-interpolation-filters"> {
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    width?: FunctionMaybe<number | string>;
    height?: FunctionMaybe<number | string>;
    result?: FunctionMaybe<string>;
  }
  interface SingleInputFilterSVGAttributes {
    in?: FunctionMaybe<string>;
  }
  interface DoubleInputFilterSVGAttributes {
    in?: FunctionMaybe<string>;
    in2?: FunctionMaybe<string>;
  }
  interface FitToViewBoxSVGAttributes {
    viewBox?: FunctionMaybe<string>;
    preserveAspectRatio?: FunctionMaybe<SVGPreserveAspectRatio>;
  }
  interface GradientElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes {
    gradientUnits?: FunctionMaybe<SVGUnits>;
    gradientTransform?: FunctionMaybe<string>;
    spreadMethod?: FunctionMaybe<"pad" | "reflect" | "repeat">;
  }
  interface GraphicsElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "clip-rule"
        | "mask"
        | "pointer-events"
        | "cursor"
        | "opacity"
        | "filter"
        | "display"
        | "visibility"
        | "color-interpolation"
        | "color-rendering"
      > {}
  interface LightSourceElementSVGAttributes<T> extends CoreSVGAttributes<T> {}
  interface NewViewportSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "overflow" | "clip"> {
    viewBox?: FunctionMaybe<string>;
  }
  interface ShapeElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "color"
        | "fill"
        | "fill-rule"
        | "fill-opacity"
        | "stroke"
        | "stroke-width"
        | "stroke-linecap"
        | "stroke-linejoin"
        | "stroke-miterlimit"
        | "stroke-dasharray"
        | "stroke-dashoffset"
        | "stroke-opacity"
        | "shape-rendering"
      > {}
  interface TextContentElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "font-family"
        | "font-style"
        | "font-variant"
        | "font-weight"
        | "font-stretch"
        | "font-size"
        | "font-size-adjust"
        | "kerning"
        | "letter-spacing"
        | "word-spacing"
        | "text-decoration"
        | "glyph-orientation-horizontal"
        | "glyph-orientation-vertical"
        | "direction"
        | "unicode-bidi"
        | "text-anchor"
        | "dominant-baseline"
        | "color"
        | "fill"
        | "fill-rule"
        | "fill-opacity"
        | "stroke"
        | "stroke-width"
        | "stroke-linecap"
        | "stroke-linejoin"
        | "stroke-miterlimit"
        | "stroke-dasharray"
        | "stroke-dashoffset"
        | "stroke-opacity"
      > {}
  interface ZoomAndPanSVGAttributes {
    zoomAndPan?: FunctionMaybe<"disable" | "magnify">;
  }
  interface AnimateSVGAttributes<T>
    extends AnimationElementSVGAttributes<T>,
      AnimationAttributeTargetSVGAttributes,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes,
      Pick<PresentationSVGAttributes, "color-interpolation" | "color-rendering"> {}
  interface AnimateMotionSVGAttributes<T>
    extends AnimationElementSVGAttributes<T>,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes {
    path?: FunctionMaybe<string>;
    keyPoints?: FunctionMaybe<string>;
    rotate?: FunctionMaybe<number | string | "auto" | "auto-reverse">;
    origin?: FunctionMaybe<"default">;
  }
  interface AnimateTransformSVGAttributes<T>
    extends AnimationElementSVGAttributes<T>,
      AnimationAttributeTargetSVGAttributes,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes {
    type?: FunctionMaybe<"translate" | "scale" | "rotate" | "skewX" | "skewY">;
  }
  interface CircleSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {
    cx?: FunctionMaybe<number | string>;
    cy?: FunctionMaybe<number | string>;
    r?: FunctionMaybe<number | string>;
  }
  interface ClipPathSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    clipPathUnits?: FunctionMaybe<SVGUnits>;
  }
  interface DefsSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {}
  interface DescSVGAttributes<T> extends CoreSVGAttributes<T>, StylableSVGAttributes {}
  interface EllipseSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {
    cx?: FunctionMaybe<number | string>;
    cy?: FunctionMaybe<number | string>;
    rx?: FunctionMaybe<number | string>;
    ry?: FunctionMaybe<number | string>;
  }
  interface FeBlendSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    mode?: FunctionMaybe<"normal" | "multiply" | "screen" | "darken" | "lighten">;
  }
  interface FeColorMatrixSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    type?: FunctionMaybe<"matrix" | "saturate" | "hueRotate" | "luminanceToAlpha">;
    values?: FunctionMaybe<string>;
  }
  interface FeComponentTransferSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {}
  interface FeCompositeSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    operator?: FunctionMaybe<"over" | "in" | "out" | "atop" | "xor" | "arithmetic">;
    k1?: FunctionMaybe<number | string>;
    k2?: FunctionMaybe<number | string>;
    k3?: FunctionMaybe<number | string>;
    k4?: FunctionMaybe<number | string>;
  }
  interface FeConvolveMatrixSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    order?: FunctionMaybe<number | string>;
    kernelMatrix?: FunctionMaybe<string>;
    divisor?: FunctionMaybe<number | string>;
    bias?: FunctionMaybe<number | string>;
    targetX?: FunctionMaybe<number | string>;
    targetY?: FunctionMaybe<number | string>;
    edgeMode?: FunctionMaybe<"duplicate" | "wrap" | "none">;
    kernelUnitLength?: FunctionMaybe<number | string>;
    preserveAlpha?: FunctionMaybe<"true" | "false">;
  }
  interface FeDiffuseLightingSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "lighting-color"> {
    surfaceScale?: FunctionMaybe<number | string>;
    diffuseConstant?: FunctionMaybe<number | string>;
    kernelUnitLength?: FunctionMaybe<number | string>;
  }
  interface FeDisplacementMapSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    scale?: FunctionMaybe<number | string>;
    xChannelSelector?: FunctionMaybe<"R" | "G" | "B" | "A">;
    yChannelSelector?: FunctionMaybe<"R" | "G" | "B" | "A">;
  }
  interface FeDistantLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    azimuth?: FunctionMaybe<number | string>;
    elevation?: FunctionMaybe<number | string>;
  }
  interface FeFloodSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "flood-color" | "flood-opacity"> {}
  interface FeFuncSVGAttributes<T> extends CoreSVGAttributes<T> {
    type?: "identity" | "table" | "discrete" | "linear" | "gamma";
    tableValues?: FunctionMaybe<string>;
    slope?: FunctionMaybe<number | string>;
    intercept?: FunctionMaybe<number | string>;
    amplitude?: FunctionMaybe<number | string>;
    exponent?: FunctionMaybe<number | string>;
    offset?: FunctionMaybe<number | string>;
  }
  interface FeGaussianBlurSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    stdDeviation?: FunctionMaybe<number | string>;
  }
  interface FeImageSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes {
    preserveAspectRatio?: FunctionMaybe<SVGPreserveAspectRatio>;
    href?: FunctionMaybe<string>;
  }
  interface FeMergeSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes {}
  interface FeMergeNodeSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      SingleInputFilterSVGAttributes {}
  interface FeMorphologySVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    operator?: FunctionMaybe<"erode" | "dilate">;
    radius?: FunctionMaybe<number | string>;
  }
  interface FeOffsetSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    dx?: FunctionMaybe<number | string>;
    dy?: FunctionMaybe<number | string>;
  }
  interface FePointLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    z?: FunctionMaybe<number | string>;
  }
  interface FeSpecularLightingSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "lighting-color"> {
    surfaceScale?: FunctionMaybe<string>;
    specularConstant?: FunctionMaybe<string>;
    specularExponent?: FunctionMaybe<string>;
    kernelUnitLength?: FunctionMaybe<number | string>;
  }
  interface FeSpotLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    z?: FunctionMaybe<number | string>;
    pointsAtX?: FunctionMaybe<number | string>;
    pointsAtY?: FunctionMaybe<number | string>;
    pointsAtZ?: FunctionMaybe<number | string>;
    specularExponent?: FunctionMaybe<number | string>;
    limitingConeAngle?: FunctionMaybe<number | string>;
  }
  interface FeTileSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {}
  interface FeTurbulanceSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes {
    baseFrequency?: FunctionMaybe<number | string>;
    numOctaves?: FunctionMaybe<number | string>;
    seed?: FunctionMaybe<number | string>;
    stitchTiles?: FunctionMaybe<"stitch" | "noStitch">;
    type?: FunctionMaybe<"fractalNoise" | "turbulence">;
  }
  interface FilterSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes {
    filterUnits?: FunctionMaybe<SVGUnits>;
    primitiveUnits?: FunctionMaybe<SVGUnits>;
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    width?: FunctionMaybe<number | string>;
    height?: FunctionMaybe<number | string>;
    filterRes?: FunctionMaybe<number | string>;
  }
  interface ForeignObjectSVGAttributes<T>
    extends NewViewportSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "display" | "visibility"> {
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    width?: FunctionMaybe<number | string>;
    height?: FunctionMaybe<number | string>;
  }
  interface GSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "display" | "visibility"> {}
  interface ImageSVGAttributes<T>
    extends NewViewportSVGAttributes<T>,
      GraphicsElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "color-profile" | "image-rendering"> {
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    width?: FunctionMaybe<number | string>;
    height?: FunctionMaybe<number | string>;
    preserveAspectRatio?: FunctionMaybe<ImagePreserveAspectRatio>;
    href?: FunctionMaybe<string>;
  }
  interface LineSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "marker-start" | "marker-mid" | "marker-end"> {
    x1?: FunctionMaybe<number | string>;
    y1?: FunctionMaybe<number | string>;
    x2?: FunctionMaybe<number | string>;
    y2?: FunctionMaybe<number | string>;
  }
  interface LinearGradientSVGAttributes<T> extends GradientElementSVGAttributes<T> {
    x1?: FunctionMaybe<number | string>;
    x2?: FunctionMaybe<number | string>;
    y1?: FunctionMaybe<number | string>;
    y2?: FunctionMaybe<number | string>;
  }
  interface MarkerSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      Pick<PresentationSVGAttributes, "overflow" | "clip"> {
    markerUnits?: FunctionMaybe<"strokeWidth" | "userSpaceOnUse">;
    refX?: FunctionMaybe<number | string>;
    refY?: FunctionMaybe<number | string>;
    markerWidth?: FunctionMaybe<number | string>;
    markerHeight?: FunctionMaybe<number | string>;
    orient?: FunctionMaybe<string>;
  }
  interface MaskSVGAttributes<T>
    extends Omit<ContainerElementSVGAttributes<T>, "opacity" | "filter">,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes {
    maskUnits?: FunctionMaybe<SVGUnits>;
    maskContentUnits?: FunctionMaybe<SVGUnits>;
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    width?: FunctionMaybe<number | string>;
    height?: FunctionMaybe<number | string>;
  }
  interface MetadataSVGAttributes<T> extends CoreSVGAttributes<T> {}
  interface PathSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "marker-start" | "marker-mid" | "marker-end"> {
    d?: FunctionMaybe<string>;
    pathLength?: FunctionMaybe<number | string>;
  }
  interface PatternSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      Pick<PresentationSVGAttributes, "overflow" | "clip"> {
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    width?: FunctionMaybe<number | string>;
    height?: FunctionMaybe<number | string>;
    patternUnits?: FunctionMaybe<SVGUnits>;
    patternContentUnits?: FunctionMaybe<SVGUnits>;
    patternTransform?: FunctionMaybe<string>;
  }
  interface PolygonSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "marker-start" | "marker-mid" | "marker-end"> {
    points?: FunctionMaybe<string>;
  }
  interface PolylineSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "marker-start" | "marker-mid" | "marker-end"> {
    points?: FunctionMaybe<string>;
  }
  interface RadialGradientSVGAttributes<T> extends GradientElementSVGAttributes<T> {
    cx?: FunctionMaybe<number | string>;
    cy?: FunctionMaybe<number | string>;
    r?: FunctionMaybe<number | string>;
    fx?: FunctionMaybe<number | string>;
    fy?: FunctionMaybe<number | string>;
  }
  interface RectSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    width?: FunctionMaybe<number | string>;
    height?: FunctionMaybe<number | string>;
    rx?: FunctionMaybe<number | string>;
    ry?: FunctionMaybe<number | string>;
  }
  interface StopSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "stop-color" | "stop-opacity"> {
    offset?: FunctionMaybe<number | string>;
  }
  interface SvgSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      NewViewportSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      ZoomAndPanSVGAttributes,
      PresentationSVGAttributes {
    version?: FunctionMaybe<string>;
    baseProfile?: FunctionMaybe<string>;
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    width?: FunctionMaybe<number | string>;
    height?: FunctionMaybe<number | string>;
    contentScriptType?: FunctionMaybe<string>;
    contentStyleType?: FunctionMaybe<string>;
    xmlns?: FunctionMaybe<string>;
  }
  interface SwitchSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "display" | "visibility"> {}
  interface SymbolSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      NewViewportSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes {}
  interface TextSVGAttributes<T>
    extends TextContentElementSVGAttributes<T>,
      GraphicsElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "writing-mode" | "text-rendering"> {
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    dx?: FunctionMaybe<number | string>;
    dy?: FunctionMaybe<number | string>;
    rotate?: FunctionMaybe<number | string>;
    textLength?: FunctionMaybe<number | string>;
    lengthAdjust?: FunctionMaybe<"spacing" | "spacingAndGlyphs">;
  }
  interface TextPathSVGAttributes<T>
    extends TextContentElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      Pick<
        PresentationSVGAttributes,
        "alignment-baseline" | "baseline-shift" | "display" | "visibility"
      > {
    startOffset?: FunctionMaybe<number | string>;
    method?: FunctionMaybe<"align" | "stretch">;
    spacing?: FunctionMaybe<"auto" | "exact">;
    href?: FunctionMaybe<string>;
  }
  interface TSpanSVGAttributes<T>
    extends TextContentElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      Pick<
        PresentationSVGAttributes,
        "alignment-baseline" | "baseline-shift" | "display" | "visibility"
      > {
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    dx?: FunctionMaybe<number | string>;
    dy?: FunctionMaybe<number | string>;
    rotate?: FunctionMaybe<number | string>;
    textLength?: FunctionMaybe<number | string>;
    lengthAdjust?: FunctionMaybe<"spacing" | "spacingAndGlyphs">;
  }
  interface UseSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {
    x?: FunctionMaybe<number | string>;
    y?: FunctionMaybe<number | string>;
    width?: FunctionMaybe<number | string>;
    height?: FunctionMaybe<number | string>;
    href?: FunctionMaybe<string>;
  }
  interface ViewSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      FitToViewBoxSVGAttributes,
      ZoomAndPanSVGAttributes {
    viewTarget?: FunctionMaybe<string>;
  }
  interface IntrinsicElements {
    a: AnchorHTMLAttributes<HTMLAnchorElement>;
    abbr: HTMLAttributes<HTMLElement>;
    address: HTMLAttributes<HTMLElement>;
    area: AreaHTMLAttributes<HTMLAreaElement>;
    article: HTMLAttributes<HTMLElement>;
    aside: HTMLAttributes<HTMLElement>;
    audio: AudioHTMLAttributes<HTMLAudioElement>;
    b: HTMLAttributes<HTMLElement>;
    base: BaseHTMLAttributes<HTMLBaseElement>;
    bdi: HTMLAttributes<HTMLElement>;
    bdo: HTMLAttributes<HTMLElement>;
    big: HTMLAttributes<HTMLElement>;
    blockquote: BlockquoteHTMLAttributes<HTMLElement>;
    body: HTMLAttributes<HTMLBodyElement>;
    br: HTMLAttributes<HTMLBRElement>;
    button: ButtonHTMLAttributes<HTMLButtonElement>;
    canvas: CanvasHTMLAttributes<HTMLCanvasElement>;
    caption: HTMLAttributes<HTMLElement>;
    cite: HTMLAttributes<HTMLElement>;
    code: HTMLAttributes<HTMLElement>;
    col: ColHTMLAttributes<HTMLTableColElement>;
    colgroup: ColgroupHTMLAttributes<HTMLTableColElement>;
    data: DataHTMLAttributes<HTMLElement>;
    datalist: HTMLAttributes<HTMLDataListElement>;
    dd: HTMLAttributes<HTMLElement>;
    del: HTMLAttributes<HTMLElement>;
    details: DetailsHtmlAttributes<HTMLDetailsElement>;
    dfn: HTMLAttributes<HTMLElement>;
    dialog: DialogHtmlAttributes<HTMLElement>;
    div: HTMLAttributes<HTMLDivElement>;
    dl: HTMLAttributes<HTMLDListElement>;
    dt: HTMLAttributes<HTMLElement>;
    em: HTMLAttributes<HTMLElement>;
    embed: EmbedHTMLAttributes<HTMLEmbedElement>;
    fieldset: FieldsetHTMLAttributes<HTMLFieldSetElement>;
    figcaption: HTMLAttributes<HTMLElement>;
    figure: HTMLAttributes<HTMLElement>;
    footer: HTMLAttributes<HTMLElement>;
    form: FormHTMLAttributes<HTMLFormElement>;
    h1: HTMLAttributes<HTMLHeadingElement>;
    h2: HTMLAttributes<HTMLHeadingElement>;
    h3: HTMLAttributes<HTMLHeadingElement>;
    h4: HTMLAttributes<HTMLHeadingElement>;
    h5: HTMLAttributes<HTMLHeadingElement>;
    h6: HTMLAttributes<HTMLHeadingElement>;
    head: HTMLAttributes<HTMLHeadElement>;
    header: HTMLAttributes<HTMLElement>;
    hgroup: HTMLAttributes<HTMLElement>;
    hr: HTMLAttributes<HTMLHRElement>;
    html: HTMLAttributes<HTMLHtmlElement>;
    i: HTMLAttributes<HTMLElement>;
    iframe: IframeHTMLAttributes<HTMLIFrameElement>;
    img: ImgHTMLAttributes<HTMLImageElement>;
    input: InputHTMLAttributes<HTMLInputElement>;
    ins: InsHTMLAttributes<HTMLModElement>;
    kbd: HTMLAttributes<HTMLElement>;
    keygen: KeygenHTMLAttributes<HTMLElement>;
    label: LabelHTMLAttributes<HTMLLabelElement>;
    legend: HTMLAttributes<HTMLLegendElement>;
    li: LiHTMLAttributes<HTMLLIElement>;
    link: LinkHTMLAttributes<HTMLLinkElement>;
    main: HTMLAttributes<HTMLElement>;
    map: MapHTMLAttributes<HTMLMapElement>;
    mark: HTMLAttributes<HTMLElement>;
    menu: MenuHTMLAttributes<HTMLElement>;
    menuitem: HTMLAttributes<HTMLElement>;
    meta: MetaHTMLAttributes<HTMLMetaElement>;
    meter: MeterHTMLAttributes<HTMLElement>;
    nav: HTMLAttributes<HTMLElement>;
    noindex: HTMLAttributes<HTMLElement>;
    noscript: HTMLAttributes<HTMLElement>;
    object: ObjectHTMLAttributes<HTMLObjectElement>;
    ol: OlHTMLAttributes<HTMLOListElement>;
    optgroup: OptgroupHTMLAttributes<HTMLOptGroupElement>;
    option: OptionHTMLAttributes<HTMLOptionElement>;
    output: OutputHTMLAttributes<HTMLElement>;
    p: HTMLAttributes<HTMLParagraphElement>;
    param: ParamHTMLAttributes<HTMLParamElement>;
    picture: HTMLAttributes<HTMLElement>;
    pre: HTMLAttributes<HTMLPreElement>;
    progress: ProgressHTMLAttributes<HTMLProgressElement>;
    q: QuoteHTMLAttributes<HTMLQuoteElement>;
    rp: HTMLAttributes<HTMLElement>;
    rt: HTMLAttributes<HTMLElement>;
    ruby: HTMLAttributes<HTMLElement>;
    s: HTMLAttributes<HTMLElement>;
    samp: HTMLAttributes<HTMLElement>;
    script: ScriptHTMLAttributes<HTMLElement>;
    section: HTMLAttributes<HTMLElement>;
    select: SelectHTMLAttributes<HTMLSelectElement>;
    slot: HTMLSlotElementAttributes;
    small: HTMLAttributes<HTMLElement>;
    source: SourceHTMLAttributes<HTMLSourceElement>;
    span: HTMLAttributes<HTMLSpanElement>;
    strong: HTMLAttributes<HTMLElement>;
    style: StyleHTMLAttributes<HTMLStyleElement>;
    sub: HTMLAttributes<HTMLElement>;
    summary: HTMLAttributes<HTMLElement>;
    sup: HTMLAttributes<HTMLElement>;
    table: HTMLAttributes<HTMLTableElement>;
    tbody: HTMLAttributes<HTMLTableSectionElement>;
    td: TdHTMLAttributes<HTMLTableDataCellElement>;
    textarea: TextareaHTMLAttributes<HTMLTextAreaElement>;
    tfoot: HTMLAttributes<HTMLTableSectionElement>;
    th: ThHTMLAttributes<HTMLTableHeaderCellElement>;
    thead: HTMLAttributes<HTMLTableSectionElement>;
    time: TimeHTMLAttributes<HTMLElement>;
    title: HTMLAttributes<HTMLTitleElement>;
    tr: HTMLAttributes<HTMLTableRowElement>;
    track: TrackHTMLAttributes<HTMLTrackElement>;
    u: HTMLAttributes<HTMLElement>;
    ul: HTMLAttributes<HTMLUListElement>;
    var: HTMLAttributes<HTMLElement>;
    video: VideoHTMLAttributes<HTMLVideoElement>;
    wbr: HTMLAttributes<HTMLElement>;
    svg: SvgSVGAttributes<SVGSVGElement>;
    animate: AnimateSVGAttributes<SVGAnimateElement>;
    animateMotion: AnimateMotionSVGAttributes<SVGAnimateMotionElement>;
    animateTransform: AnimateTransformSVGAttributes<SVGAnimateTransformElement>;
    circle: CircleSVGAttributes<SVGCircleElement>;
    clipPath: ClipPathSVGAttributes<SVGClipPathElement>;
    defs: DefsSVGAttributes<SVGDefsElement>;
    desc: DescSVGAttributes<SVGDescElement>;
    ellipse: EllipseSVGAttributes<SVGEllipseElement>;
    feBlend: FeBlendSVGAttributes<SVGFEBlendElement>;
    feColorMatrix: FeColorMatrixSVGAttributes<SVGFEColorMatrixElement>;
    feComponentTransfer: FeComponentTransferSVGAttributes<SVGFEComponentTransferElement>;
    feComposite: FeCompositeSVGAttributes<SVGFECompositeElement>;
    feConvolveMatrix: FeConvolveMatrixSVGAttributes<SVGFEConvolveMatrixElement>;
    feDiffuseLighting: FeDiffuseLightingSVGAttributes<SVGFEDiffuseLightingElement>;
    feDisplacementMap: FeDisplacementMapSVGAttributes<SVGFEDisplacementMapElement>;
    feDistantLight: FeDistantLightSVGAttributes<SVGFEDistantLightElement>;
    feFlood: FeFloodSVGAttributes<SVGFEFloodElement>;
    feFuncA: FeFuncSVGAttributes<SVGFEFuncAElement>;
    feFuncB: FeFuncSVGAttributes<SVGFEFuncBElement>;
    feFuncG: FeFuncSVGAttributes<SVGFEFuncGElement>;
    feFuncR: FeFuncSVGAttributes<SVGFEFuncRElement>;
    feGaussianBlur: FeGaussianBlurSVGAttributes<SVGFEGaussianBlurElement>;
    feImage: FeImageSVGAttributes<SVGFEImageElement>;
    feMerge: FeMergeSVGAttributes<SVGFEMergeElement>;
    feMergeNode: FeMergeNodeSVGAttributes<SVGFEMergeNodeElement>;
    feMorphology: FeMorphologySVGAttributes<SVGFEMorphologyElement>;
    feOffset: FeOffsetSVGAttributes<SVGFEOffsetElement>;
    fePointLight: FePointLightSVGAttributes<SVGFEPointLightElement>;
    feSpecularLighting: FeSpecularLightingSVGAttributes<SVGFESpecularLightingElement>;
    feSpotLight: FeSpotLightSVGAttributes<SVGFESpotLightElement>;
    feTile: FeTileSVGAttributes<SVGFETileElement>;
    feTurbulence: FeTurbulanceSVGAttributes<SVGFETurbulenceElement>;
    filter: FilterSVGAttributes<SVGFilterElement>;
    foreignObject: ForeignObjectSVGAttributes<SVGForeignObjectElement>;
    g: GSVGAttributes<SVGGElement>;
    image: ImageSVGAttributes<SVGImageElement>;
    line: LineSVGAttributes<SVGLineElement>;
    linearGradient: LinearGradientSVGAttributes<SVGLinearGradientElement>;
    marker: MarkerSVGAttributes<SVGMarkerElement>;
    mask: MaskSVGAttributes<SVGMaskElement>;
    metadata: MetadataSVGAttributes<SVGMetadataElement>;
    path: PathSVGAttributes<SVGPathElement>;
    pattern: PatternSVGAttributes<SVGPatternElement>;
    polygon: PolygonSVGAttributes<SVGPolygonElement>;
    polyline: PolylineSVGAttributes<SVGPolylineElement>;
    radialGradient: RadialGradientSVGAttributes<SVGRadialGradientElement>;
    rect: RectSVGAttributes<SVGRectElement>;
    stop: StopSVGAttributes<SVGStopElement>;
    switch: SwitchSVGAttributes<SVGSwitchElement>;
    symbol: SymbolSVGAttributes<SVGSymbolElement>;
    text: TextSVGAttributes<SVGTextElement>;
    textPath: TextPathSVGAttributes<SVGTextPathElement>;
    tspan: TSpanSVGAttributes<SVGTSpanElement>;
    use: UseSVGAttributes<SVGUseElement>;
    view: ViewSVGAttributes<SVGViewElement>;
  }
}
