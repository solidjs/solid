import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
var _tmpl$ = [
	"<html",
	"><head><title>🔥 Blazing 🔥</title><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><link rel=\"stylesheet\" href=\"/styles.css\"><!--$-->",
	"<!--/--></head><body><header><h1>Welcome to the Jungle</h1></header><!--$-->",
	"<!--/--><footer>The Bottom</footer></body></html>"
];
var _tmpl$2 = [
	"<head",
	"><title>🔥 Blazing 🔥</title><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><link rel=\"stylesheet\" href=\"/styles.css\"><!--$-->",
	"<!--/--></head>"
];
var _tmpl$3 = [
	"<body",
	"><header><h1>Welcome to the Jungle</h1></header><!--$-->",
	"<!--/--><footer>The Bottom</footer></body>"
];
var _tmpl$4 = [
	"<html",
	"><!--$-->",
	"<!--/--><!--$-->",
	"<!--/--></html>"
];
var _v$ = _$ssrHydrationKey(), _v$2 = _$escape(Assets({})), _v$3 = _$escape(App({}));
const template = _$ssr(_tmpl$, _v$, _v$2, _v$3);
var _v$4 = _$ssrHydrationKey(), _v$5 = _$escape(Assets({}));
const templateHead = _$ssr(_tmpl$2, _v$4, _v$5);
var _v$6 = _$ssrHydrationKey(), _v$7 = _$escape(App({}));
const templateBody = _$ssr(_tmpl$3, _v$6, _v$7);
var _v$8 = _$ssrHydrationKey(), _v$9 = _$escape(Head({})), _v$10 = _$escape(Body({}));
const templateEmptied = _$ssr(_tmpl$4, _v$8, _v$9, _v$10);
