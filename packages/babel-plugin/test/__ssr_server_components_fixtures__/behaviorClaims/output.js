import { escape as _$escape } from "r-server";
import { ssrClassName as _$ssrClassName } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrClaim as _$ssrClaim } from "r-server";
import { sharedConfig as _$sharedConfig } from "r-server";
var _tmpl$ = [
    '<div><button class="copy"',
    ">Copy</button><input",
    "><span",
    '>warns at render when the gate is open</span><a href="/x"',
    ">multiple refs merge to an array</a><section>capture variants stay dropped</section></div>"
  ],
  _tmpl$2 = ['<li class="', '"', ">", "</li>"];
var _v$ =
    _$sharedConfig.context && _$sharedConfig.context.claims
      ? _$ssrClaim({
          click: props.onCopy,
          ref: props.btn
        })
      : "",
  _v$2 =
    _$sharedConfig.context && _$sharedConfig.context.claims
      ? _$ssrClaim({
          input: props.onType,
          "custom-thing": props.onCustom
        })
      : "",
  _v$3 =
    _$sharedConfig.context && _$sharedConfig.context.claims
      ? _$ssrClaim({
          click: localHandler
        })
      : "",
  _v$4 =
    _$sharedConfig.context && _$sharedConfig.context.claims
      ? _$ssrClaim({
          ref: [first, second]
        })
      : "";
// Ref/event positions on server intrinsics compile to one guarded
// whole-attribute claim hole per element (`_bnd`), gated on the render
// context's claims flag so plain SSR never evaluates the expressions.
const template = _$ssr(_tmpl$, _v$, _v$2, _v$3, _v$4);
var _v$5 = () => _$ssrClassName(status()),
  _v$6 =
    _$sharedConfig.context && _$sharedConfig.context.claims
      ? _$ssrClaim({
          click: props.onPick
        })
      : "",
  _v$7 = () => _$escape(label());
const dynamicToo = _$ssr(_tmpl$2, _v$5, _v$6, _v$7);
