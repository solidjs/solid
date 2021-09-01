const babel = require('@babel/core');
const preset = require('.');
const assert = require('assert');

const { code } = babel.transformSync('const v = <div a b={2} />;', {
	presets: [
		preset
	],
	babelrc: false,
	compact: true
});

assert.equal(code, 'import{template as _$template}from"solid-js/web";const _tmpl$=_$template(`<div a b="2"></div>`,2);const v=_tmpl$.cloneNode(true);');
console.log('passed');