// `data-*` attributes in props objects (#4082): JSX already accepts
// hyphenated names on intrinsic elements, and an object typed with the same
// element's props now accepts them too, so a function returning props to
// spread type-checks without a cast.
import type { ComponentProps, JSX } from "@solidjs/web";

export const attrs: JSX.HTMLAttributes<HTMLDivElement> = { "data-state": "open" };
export const props: ComponentProps<"div"> = { role: "button", "data-state": "open" };

function disclosure(): ComponentProps<"button"> {
  return { "aria-expanded": "false", "data-state": "closed", "data-count": 2, "data-open": false };
}
export const forwarded: ComponentProps<"button"> = { ...disclosure(), "data-extra": true };

type P = Omit<ComponentProps<"div">, "ref">;
export const withClass: P = { "data-x": "1", class: "a" };
// @ts-expect-error unknown non-data keys are still rejected
export const unknownKey: P = { foo: 1 };
// @ts-expect-error data values stay primitive
export const objectValue: P = { "data-x": {} };
