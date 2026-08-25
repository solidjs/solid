import { memo as _$memo } from "r-server";
import { scope as _$scope } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
import { mergeProps as _$mergeProps } from "r-server";
var _v$21;
var _tmpl$ = ["<div", "></div>"];
var _tmpl$2 = [
	"<module",
	">",
	"</module>"
];
var _tmpl$3 = ["<module", ">Hello</module>"];
var _tmpl$4 = [
	"<module",
	">Hi <!--$-->",
	"<!--/--></module>"
];
var _tmpl$5 = ["<div", ">Test 1</div>"];
var _tmpl$6 = [
	"<div",
	">",
	"</div>"
];
var _tmpl$7 = ["<module", ">hello</module>"];
var _tmpl$8 = [
	"<section",
	"><!--$-->",
	"<!--/--><!--$-->",
	"<!--/--></section>"
];
var _tmpl$9 = [
	"<section",
	"><!--$-->",
	"<!--/--><span>native</span></section>"
];
var _tmpl$10 = ["<span", ">fallback</span>"];
var _tmpl$11 = ["<span", ">child</span>"];
var _tmpl$12 = ["<span", ">sibling</span>"];
var _v$ = _$ssrHydrationKey();
const children = _$ssr(_tmpl$, _v$);
const dynamic = { children };
const template = Module({ children });
var _v$2 = _$ssrHydrationKey(), _v$3 = _$escape(children);
const template2 = _$ssr(_tmpl$2, _v$2, _v$3);
var _v$4 = _$ssrHydrationKey();
const template3 = _$ssr(_tmpl$3, _v$4);
var _v$5 = _$ssrHydrationKey(), _v$6 = _$escape(Hello({}));
const template4 = _$ssr(_tmpl$2, _v$5, _v$6);
var _v$7 = _$ssrHydrationKey(), _v$8 = _$scope(() => {
	return _$escape(dynamic.children);
});
const template5 = _$ssr(_tmpl$2, _v$7, _v$8);
const template6 = Module({ get children() {
	return dynamic.children;
} });
const template7 = _$ssrElement("module", dynamic, undefined, true);
const template8 = _$ssrElement("module", dynamic, () => {
	return "Hello";
}, true);
const template9 = _$ssrElement("module", dynamic, () => {
	return _$scope(() => {
		return _$escape(dynamic.children);
	});
}, true);
const template10 = Module(_$mergeProps(dynamic, { children: "Hello" }));
var _v$9 = _$ssrHydrationKey(), _v$10 = _$escape(
	/*@static*/
	state.children
);
const template11 = _$ssr(_tmpl$2, _v$9, _v$10);
const template12 = Module({ children: /*@static*/ state.children });
var _v$11 = _$ssrHydrationKey(), _v$12 = _$escape(children);
const template13 = _$ssr(_tmpl$2, _v$11, _v$12);
const template14 = Module({ children });
var _v$13 = _$ssrHydrationKey(), _v$14 = _$scope(() => {
	return _$escape(dynamic.children);
});
const template15 = _$ssr(_tmpl$2, _v$13, _v$14);
const template16 = Module({ get children() {
	return dynamic.children;
} });
var _v$15 = _$ssrHydrationKey(), _v$16 = _$escape(children);
const template18 = _$ssr(_tmpl$4, _v$15, _v$16);
const template19 = Module({ get children() {
	return ["Hi ", children];
} });
var _v$17 = _$ssrHydrationKey(), _v$18 = _$scope(() => {
	return _$escape(children());
});
const template20 = _$ssr(_tmpl$2, _v$17, _v$18);
const template21 = Module({ get children() {
	return children();
} });
var _v$19 = _$ssrHydrationKey(), _v$20 = _$scope(() => {
	return _$escape(state.children());
});
const template22 = _$ssr(_tmpl$2, _v$19, _v$20);
const template23 = Module({ get children() {
	return state.children();
} });
const template24 = _$ssrElement("module", dynamic, () => {
	return [
		"Hi",
		"<!--$-->",
		_$scope(() => {
			return _$escape(dynamic.children);
		}),
		"<!--/-->"
	];
}, true);
const tiles = [];
tiles.push((_v$21 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$21)));
var _v$22 = _$ssrHydrationKey(), _v$23 = _$escape(tiles);
const template25 = _$ssr(_tmpl$6, _v$22, _v$23);
var _v$24 = _$ssrHydrationKey(), _v$25 = () => {
	return _$escape((expression(), "static"));
};
const comma = _$ssr(_tmpl$6, _v$24, _v$25);
var _v$26 = _$ssrHydrationKey(), _v$27 = _$scope(() => {
	return _$escape(children()());
});
const double = _$ssr(_tmpl$6, _v$26, _v$27);
const hello = "hello";
var _v$28 = _$ssrHydrationKey();
const staticChildren = _$ssr(_tmpl$7, _v$28);
var _v$29 = _$ssrHydrationKey();
const foldedChildren = _$ssr(_tmpl$7, _v$29);
const childrenBeforeSpread = _$ssrElement("module", () => {
	return _$mergeProps({ get children() {
		return fallback();
	} }, props);
}, undefined, true);
const childrenAfterSpread = _$ssrElement("module", () => {
	return _$mergeProps(props, { get children() {
		return later();
	} });
}, undefined, true);
function OrderedParent(props) {
	var _v$30 = _$ssrHydrationKey(), _v$31 = _$scope(() => {
		return _$escape(props.children);
	}), _v$32 = _$escape(OrderedSibling({}));
	return _$ssr(_tmpl$8, _v$30, _v$31, _v$32);
}
function OrderedNativeParent(props) {
	var _v$33 = _$ssrHydrationKey(), _v$34 = _$scope(() => {
		return _$escape(props.children);
	});
	return _$ssr(_tmpl$9, _v$33, _v$34);
}
function OrderedExpressionParent(props) {
	var _v$35 = _$ssrHydrationKey(), _v$36 = _$scope(() => {
		return _$escape(props.render());
	}), _v$37 = _$escape(OrderedSibling({}));
	return _$ssr(_tmpl$8, _v$35, _v$36, _v$37);
}
function OrderedConditionalParent(props) {
	var _v$38 = _$ssrHydrationKey(), _v$39 = _$scope((() => {
		var _c$ = _$memo(() => {
			return !!props.when;
		});
		return () => {
			var _v$41;
			return _c$() ? _$escape(OrderedChild({})) : (_v$41 = _$ssrHydrationKey(), _$ssr(_tmpl$10, _v$41));
		};
	})()), _v$40 = _$escape(OrderedSibling({}));
	return _$ssr(_tmpl$8, _v$38, _v$39, _v$40);
}
function OrderedChild() {
	var _v$42 = _$ssrHydrationKey();
	return _$ssr(_tmpl$11, _v$42);
}
function OrderedSibling() {
	var _v$43 = _$ssrHydrationKey();
	return _$ssr(_tmpl$12, _v$43);
}
const orderedComponent = OrderedParent({ get children() {
	return OrderedChild({});
} });
const orderedNative = OrderedNativeParent({ get children() {
	return OrderedChild({});
} });
const orderedExpression = OrderedExpressionParent({ render: () => OrderedChild({}) });
const orderedConditional = OrderedConditionalParent({ when: true });
