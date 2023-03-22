import * as csstype from 'csstype';

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
  interface DOMAttributes<T> extends CustomAttributes<T>, DirectiveAttributes, DirectiveFunctionAttributes<T>,
                                     PropAttributes, AttrAttributes, OnAttributes<T>, OnCaptureAttributes<T>,
                                     CustomEventHandlersCamelCase<T>, CustomEventHandlersLowerCase<T> {
    children?: Element;
    innerHTML?: string;
    innerText?: string | number;
    textContent?: string | number;
    // camel case events
    onCopy?: EventHandlerUnion<T, ClipboardEvent>;
    onCut?: EventHandlerUnion<T, ClipboardEvent>;
    onPaste?: EventHandlerUnion<T, ClipboardEvent>;
    onCompositionEnd?: EventHandlerUnion<T, CompositionEvent>;
    onCompositionStart?: EventHandlerUnion<T, CompositionEvent>;
    onCompositionUpdate?: EventHandlerUnion<T, CompositionEvent>;
    onFocusOut?: EventHandlerUnion<T, FocusEvent>;
    onFocusIn?: EventHandlerUnion<T, FocusEvent>;
    onEncrypted?: EventHandlerUnion<T, Event>;
    onDragExit?: EventHandlerUnion<T, DragEvent>;
    // lower case events
    oncopy?: EventHandlerUnion<T, ClipboardEvent>;
    oncut?: EventHandlerUnion<T, ClipboardEvent>;
    onpaste?: EventHandlerUnion<T, ClipboardEvent>;
    oncompositionend?: EventHandlerUnion<T, CompositionEvent>;
    oncompositionstart?: EventHandlerUnion<T, CompositionEvent>;
    oncompositionupdate?: EventHandlerUnion<T, CompositionEvent>;
    onfocusout?: EventHandlerUnion<T, FocusEvent>;
    onfocusin?: EventHandlerUnion<T, FocusEvent>;
    onencrypted?: EventHandlerUnion<T, Event>;
    ondragexit?: EventHandlerUnion<T, DragEvent>;
  }
  interface CustomEventHandlersCamelCase<T> {
    onAbort?: EventHandlerUnion<T, Event>;
    onAnimationEnd?: EventHandlerUnion<T, AnimationEvent>;
    onAnimationIteration?: EventHandlerUnion<T, AnimationEvent>;
    onAnimationStart?: EventHandlerUnion<T, AnimationEvent>;
    onAuxClick?: EventHandlerUnion<T, MouseEvent>;
    onBeforeInput?: EventHandlerUnion<T, InputEvent>;
    onBlur?: EventHandlerUnion<T, FocusEvent>;
    onCanPlay?: EventHandlerUnion<T, Event>;
    onCanPlayThrough?: EventHandlerUnion<T, Event>;
    onChange?: EventHandlerUnion<T, Event>;
    onClick?: EventHandlerUnion<T, MouseEvent>;
    onContextMenu?: EventHandlerUnion<T, MouseEvent>;
    onDblClick?: EventHandlerUnion<T, MouseEvent>;
    onDrag?: EventHandlerUnion<T, DragEvent>;
    onDragEnd?: EventHandlerUnion<T, DragEvent>;
    onDragEnter?: EventHandlerUnion<T, DragEvent>;
    onDragLeave?: EventHandlerUnion<T, DragEvent>;
    onDragOver?: EventHandlerUnion<T, DragEvent>;
    onDragStart?: EventHandlerUnion<T, DragEvent>;
    onDrop?: EventHandlerUnion<T, DragEvent>;
    onDurationChange?: EventHandlerUnion<T, Event>;
    onEmptied?: EventHandlerUnion<T, Event>;
    onEnded?: EventHandlerUnion<T, Event>;
    onError?: EventHandlerUnion<T, Event>;
    onFocus?: EventHandlerUnion<T, FocusEvent>;
    onGotPointerCapture?: EventHandlerUnion<T, PointerEvent>;
    onInput?: EventHandlerUnion<T, InputEvent>;
    onInvalid?: EventHandlerUnion<T, Event>;
    onKeyDown?: EventHandlerUnion<T, KeyboardEvent>;
    onKeyPress?: EventHandlerUnion<T, KeyboardEvent>;
    onKeyUp?: EventHandlerUnion<T, KeyboardEvent>;
    onLoad?: EventHandlerUnion<T, Event>;
    onLoadedData?: EventHandlerUnion<T, Event>;
    onLoadedMetadata?: EventHandlerUnion<T, Event>;
    onLoadStart?: EventHandlerUnion<T, Event>;
    onLostPointerCapture?: EventHandlerUnion<T, PointerEvent>;
    onMouseDown?: EventHandlerUnion<T, MouseEvent>;
    onMouseEnter?: EventHandlerUnion<T, MouseEvent>;
    onMouseLeave?: EventHandlerUnion<T, MouseEvent>;
    onMouseMove?: EventHandlerUnion<T, MouseEvent>;
    onMouseOut?: EventHandlerUnion<T, MouseEvent>;
    onMouseOver?: EventHandlerUnion<T, MouseEvent>;
    onMouseUp?: EventHandlerUnion<T, MouseEvent>;
    onPause?: EventHandlerUnion<T, Event>;
    onPlay?: EventHandlerUnion<T, Event>;
    onPlaying?: EventHandlerUnion<T, Event>;
    onPointerCancel?: EventHandlerUnion<T, PointerEvent>;
    onPointerDown?: EventHandlerUnion<T, PointerEvent>;
    onPointerEnter?: EventHandlerUnion<T, PointerEvent>;
    onPointerLeave?: EventHandlerUnion<T, PointerEvent>;
    onPointerMove?: EventHandlerUnion<T, PointerEvent>;
    onPointerOut?: EventHandlerUnion<T, PointerEvent>;
    onPointerOver?: EventHandlerUnion<T, PointerEvent>;
    onPointerUp?: EventHandlerUnion<T, PointerEvent>;
    onProgress?: EventHandlerUnion<T, Event>;
    onRateChange?: EventHandlerUnion<T, Event>;
    onReset?: EventHandlerUnion<T, Event>;
    onScroll?: EventHandlerUnion<T, UIEvent>;
    onSeeked?: EventHandlerUnion<T, Event>;
    onSeeking?: EventHandlerUnion<T, Event>;
    onSelect?: EventHandlerUnion<T, UIEvent>;
    onStalled?: EventHandlerUnion<T, Event>;
    onSubmit?: EventHandlerUnion<
      T,
      Event & {
        submitter: HTMLElement;
      }
    >;
    onSuspend?: EventHandlerUnion<T, Event>;
    onTimeUpdate?: EventHandlerUnion<T, Event>;
    onTouchCancel?: EventHandlerUnion<T, TouchEvent>;
    onTouchEnd?: EventHandlerUnion<T, TouchEvent>;
    onTouchMove?: EventHandlerUnion<T, TouchEvent>;
    onTouchStart?: EventHandlerUnion<T, TouchEvent>;
    onTransitionEnd?: EventHandlerUnion<T, TransitionEvent>;
    onVolumeChange?: EventHandlerUnion<T, Event>;
    onWaiting?: EventHandlerUnion<T, Event>;
    onWheel?: EventHandlerUnion<T, WheelEvent>;
  }
  /**
   * @type {GlobalEventHandlers}
   */
  interface CustomEventHandlersLowerCase<T> {
    onabort?: EventHandlerUnion<T, Event>;
    onanimationend?: EventHandlerUnion<T, AnimationEvent>;
    onanimationiteration?: EventHandlerUnion<T, AnimationEvent>;
    onanimationstart?: EventHandlerUnion<T, AnimationEvent>;
    onauxclick?: EventHandlerUnion<T, MouseEvent>;
    onbeforeinput?: EventHandlerUnion<T, InputEvent>;
    onblur?: EventHandlerUnion<T, FocusEvent>;
    oncanplay?: EventHandlerUnion<T, Event>;
    oncanplaythrough?: EventHandlerUnion<T, Event>;
    onchange?: EventHandlerUnion<T, Event>;
    onclick?: EventHandlerUnion<T, MouseEvent>;
    oncontextmenu?: EventHandlerUnion<T, MouseEvent>;
    ondblclick?: EventHandlerUnion<T, MouseEvent>;
    ondrag?: EventHandlerUnion<T, DragEvent>;
    ondragend?: EventHandlerUnion<T, DragEvent>;
    ondragenter?: EventHandlerUnion<T, DragEvent>;
    ondragleave?: EventHandlerUnion<T, DragEvent>;
    ondragover?: EventHandlerUnion<T, DragEvent>;
    ondragstart?: EventHandlerUnion<T, DragEvent>;
    ondrop?: EventHandlerUnion<T, DragEvent>;
    ondurationchange?: EventHandlerUnion<T, Event>;
    onemptied?: EventHandlerUnion<T, Event>;
    onended?: EventHandlerUnion<T, Event>;
    onerror?: EventHandlerUnion<T, Event>;
    onfocus?: EventHandlerUnion<T, FocusEvent>;
    ongotpointercapture?: EventHandlerUnion<T, PointerEvent>;
    oninput?: EventHandlerUnion<T, InputEvent>;
    oninvalid?: EventHandlerUnion<T, Event>;
    onkeydown?: EventHandlerUnion<T, KeyboardEvent>;
    onkeypress?: EventHandlerUnion<T, KeyboardEvent>;
    onkeyup?: EventHandlerUnion<T, KeyboardEvent>;
    onload?: EventHandlerUnion<T, Event>;
    onloadeddata?: EventHandlerUnion<T, Event>;
    onloadedmetadata?: EventHandlerUnion<T, Event>;
    onloadstart?: EventHandlerUnion<T, Event>;
    onlostpointercapture?: EventHandlerUnion<T, PointerEvent>;
    onmousedown?: EventHandlerUnion<T, MouseEvent>;
    onmouseenter?: EventHandlerUnion<T, MouseEvent>;
    onmouseleave?: EventHandlerUnion<T, MouseEvent>;
    onmousemove?: EventHandlerUnion<T, MouseEvent>;
    onmouseout?: EventHandlerUnion<T, MouseEvent>;
    onmouseover?: EventHandlerUnion<T, MouseEvent>;
    onmouseup?: EventHandlerUnion<T, MouseEvent>;
    onpause?: EventHandlerUnion<T, Event>;
    onplay?: EventHandlerUnion<T, Event>;
    onplaying?: EventHandlerUnion<T, Event>;
    onpointercancel?: EventHandlerUnion<T, PointerEvent>;
    onpointerdown?: EventHandlerUnion<T, PointerEvent>;
    onpointerenter?: EventHandlerUnion<T, PointerEvent>;
    onpointerleave?: EventHandlerUnion<T, PointerEvent>;
    onpointermove?: EventHandlerUnion<T, PointerEvent>;
    onpointerout?: EventHandlerUnion<T, PointerEvent>;
    onpointerover?: EventHandlerUnion<T, PointerEvent>;
    onpointerup?: EventHandlerUnion<T, PointerEvent>;
    onprogress?: EventHandlerUnion<T, Event>;
    onratechange?: EventHandlerUnion<T, Event>;
    onreset?: EventHandlerUnion<T, Event>;
    onscroll?: EventHandlerUnion<T, UIEvent>;
    onseeked?: EventHandlerUnion<T, Event>;
    onseeking?: EventHandlerUnion<T, Event>;
    onselect?: EventHandlerUnion<T, UIEvent>;
    onstalled?: EventHandlerUnion<T, Event>;
    onsubmit?: EventHandlerUnion<
      T,
      Event & {
        submitter: HTMLElement;
      }
    >;
    onsuspend?: EventHandlerUnion<T, Event>;
    ontimeupdate?: EventHandlerUnion<T, Event>;
    ontouchcancel?: EventHandlerUnion<T, TouchEvent>;
    ontouchend?: EventHandlerUnion<T, TouchEvent>;
    ontouchmove?: EventHandlerUnion<T, TouchEvent>;
    ontouchstart?: EventHandlerUnion<T, TouchEvent>;
    ontransitionend?: EventHandlerUnion<T, TransitionEvent>;
    onvolumechange?: EventHandlerUnion<T, Event>;
    onwaiting?: EventHandlerUnion<T, Event>;
    onwheel?: EventHandlerUnion<T, WheelEvent>;
  }

  interface CSSProperties extends csstype.PropertiesHyphen {
    // Override
    [key: `-${string}`]: string | number | undefined
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
  }

  interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    accessKey?: FunctionMaybe<string>;
    class?: FunctionMaybe<string> | undefined;
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
    loading?: FunctionMaybe<"eager" | "lazy">;
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
  interface TemplateHTMLAttributes<T extends HTMLTemplateElement> extends HTMLAttributes<T> {
    content?: FunctionMaybe<DocumentFragment>;
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
  interface CoreSVGAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    id?: FunctionMaybe<string>;
    lang?: FunctionMaybe<string>;
    tabIndex?: FunctionMaybe<number | string>;
    tabindex?: FunctionMaybe<number | string>;
  }
  interface StylableSVGAttributes {
    class?: FunctionMaybe<string> | undefined;
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
    pathLength?: FunctionMaybe<string | number>;
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
    href?: FunctionMaybe<string>
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
        | "pathLength"
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
    href?: string;
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
  /**
   * @type {HTMLElementTagNameMap}
   */
  interface HTMLElementTags {
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
    dialog: DialogHtmlAttributes<HTMLDialogElement>;
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
    label: LabelHTMLAttributes<HTMLLabelElement>;
    legend: HTMLAttributes<HTMLLegendElement>;
    li: LiHTMLAttributes<HTMLLIElement>;
    link: LinkHTMLAttributes<HTMLLinkElement>;
    main: HTMLAttributes<HTMLElement>;
    map: MapHTMLAttributes<HTMLMapElement>;
    mark: HTMLAttributes<HTMLElement>;
    menu: MenuHTMLAttributes<HTMLElement>;
    meta: MetaHTMLAttributes<HTMLMetaElement>;
    meter: MeterHTMLAttributes<HTMLElement>;
    nav: HTMLAttributes<HTMLElement>;
    noscript: HTMLAttributes<HTMLElement>;
    object: ObjectHTMLAttributes<HTMLObjectElement>;
    ol: OlHTMLAttributes<HTMLOListElement>;
    optgroup: OptgroupHTMLAttributes<HTMLOptGroupElement>;
    option: OptionHTMLAttributes<HTMLOptionElement>;
    output: OutputHTMLAttributes<HTMLElement>;
    p: HTMLAttributes<HTMLParagraphElement>;
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
    td: TdHTMLAttributes<HTMLTableCellElement>;
    template: TemplateHTMLAttributes<HTMLTemplateElement>;
    textarea: TextareaHTMLAttributes<HTMLTextAreaElement>;
    tfoot: HTMLAttributes<HTMLTableSectionElement>;
    th: ThHTMLAttributes<HTMLTableCellElement>;
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
  }
  /**
   * @type {HTMLElementDeprecatedTagNameMap}
   */
  interface HTMLElementDeprecatedTags {
    big: HTMLAttributes<HTMLElement>;
    keygen: KeygenHTMLAttributes<HTMLElement>;
    menuitem: HTMLAttributes<HTMLElement>;
    noindex: HTMLAttributes<HTMLElement>;
    param: ParamHTMLAttributes<HTMLParamElement>;
  }
  /**
   * @type {SVGElementTagNameMap}
   */
  interface SVGElementTags {
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
    feDropShadow: Partial<SVGFEDropShadowElement>;
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
    mpath: Partial<SVGMPathElement>;
    path: PathSVGAttributes<SVGPathElement>;
    pattern: PatternSVGAttributes<SVGPatternElement>;
    polygon: PolygonSVGAttributes<SVGPolygonElement>;
    polyline: PolylineSVGAttributes<SVGPolylineElement>;
    radialGradient: RadialGradientSVGAttributes<SVGRadialGradientElement>;
    rect: RectSVGAttributes<SVGRectElement>;
    set: Partial<SVGSetElement>;
    stop: StopSVGAttributes<SVGStopElement>;
    svg: SvgSVGAttributes<SVGSVGElement>;
    switch: SwitchSVGAttributes<SVGSwitchElement>;
    symbol: SymbolSVGAttributes<SVGSymbolElement>;
    text: TextSVGAttributes<SVGTextElement>;
    textPath: TextPathSVGAttributes<SVGTextPathElement>;
    tspan: TSpanSVGAttributes<SVGTSpanElement>;
    use: UseSVGAttributes<SVGUseElement>;
    view: ViewSVGAttributes<SVGViewElement>;
  }
  interface IntrinsicElements extends HTMLElementTags, HTMLElementDeprecatedTags, SVGElementTags {}
}
