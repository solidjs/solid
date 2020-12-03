import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";

const trailing = _$ssr("<span>Hello </span>");

const leading = _$ssr("<span> John</span>");
/* prettier-ignore */

const extraSpaces = _$ssr("<span>Hello John</span>");

const trailingExpr = _$ssr(["<span>Hello ", "</span>"], _$escape(name));

const leadingExpr = _$ssr(["<span>", " John</span>"], _$escape(greeting));
/* prettier-ignore */

const multiExpr = _$ssr(["<span>", " ", "</span>"], _$escape(greeting), _$escape(name));
/* prettier-ignore */

const multiExprSpaced = _$ssr(["<span> ", " ", " </span>"], _$escape(greeting), _$escape(name));
/* prettier-ignore */

const multiExprTogether = _$ssr(["<span> ", "", " </span>"], _$escape(greeting), _$escape(name));
/* prettier-ignore */

const multiLine = _$ssr("<span>Hello</span>");
/* prettier-ignore */

const multiLineTrailingSpace = _$ssr("<span>Hello John</span>");
/* prettier-ignore */

const escape = _$ssr("<span>&nbsp;&lt;Hi&gt;&nbsp;</span>");
