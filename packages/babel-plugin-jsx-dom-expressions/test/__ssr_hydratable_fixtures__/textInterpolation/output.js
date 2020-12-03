import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { getHydrationKey as _$getHydrationKey } from "r-server";

const trailing = _$ssr(['<span data-hk="', '">Hello </span>'], _$getHydrationKey());

const leading = _$ssr(['<span data-hk="', '"> John</span>'], _$getHydrationKey());
/* prettier-ignore */

const extraSpaces = _$ssr(["<span data-hk=\"", "\">Hello John</span>"], _$getHydrationKey());

const trailingExpr = _$ssr(
  ['<span data-hk="', '">Hello <!--#-->', "<!--/--></span>"],
  _$getHydrationKey(),
  _$escape(name)
);

const leadingExpr = _$ssr(
  ['<span data-hk="', '"><!--#-->', "<!--/--> John</span>"],
  _$getHydrationKey(),
  _$escape(greeting)
);
/* prettier-ignore */

const multiExpr = _$ssr(["<span data-hk=\"", "\"><!--#-->", "<!--/--> <!--#-->", "<!--/--></span>"], _$getHydrationKey(), _$escape(greeting), _$escape(name));
/* prettier-ignore */

const multiExprSpaced = _$ssr(["<span data-hk=\"", "\"> <!--#-->", "<!--/--> <!--#-->", "<!--/--> </span>"], _$getHydrationKey(), _$escape(greeting), _$escape(name));
/* prettier-ignore */

const multiExprTogether = _$ssr(["<span data-hk=\"", "\"> <!--#-->", "<!--/--><!--#-->", "<!--/--> </span>"], _$getHydrationKey(), _$escape(greeting), _$escape(name));
/* prettier-ignore */

const multiLine = _$ssr(["<span data-hk=\"", "\">Hello</span>"], _$getHydrationKey());
/* prettier-ignore */

const multiLineTrailingSpace = _$ssr(["<span data-hk=\"", "\">Hello John</span>"], _$getHydrationKey());
/* prettier-ignore */

const escape = _$ssr(["<span data-hk=\"", "\">&nbsp;&lt;Hi&gt;&nbsp;</span>"], _$getHydrationKey());
