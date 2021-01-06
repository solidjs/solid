/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { render, Show } from "solid-js/web";
import { MetaProvider, Title, Style, Meta, Link, Base } from '../src';

global.queueMicrotask = setImmediate;

test('renders into document.head portal', () => {
  let div = document.createElement("div");
  const snapshot = "<title>Test title</title><style>body {}</style><link href=\"index.css\"><meta charset=\"utf-8\"><base href=\"/new_base\">"
  const dispose = render(() =>
    <MetaProvider>
      <div>
        Yes render
        <Title>Test title</Title>
        <Style>{`body {}`}</Style>
        <Link href="index.css" />
        <Meta charset="utf-8" />
        <Base href="/new_base" />
      </div>
    </MetaProvider>
  , div);
  expect(document.head.innerHTML).toBe(snapshot);
  dispose();
});

test('renders only the last title', () => {
  let div = document.createElement("div");
  const snapshot = "<title>Title 3</title>";
  const dispose = render(() =>
    <MetaProvider>
      <div>
        <Title>Title 1</Title>
      </div>
      <div>
        <Title>Title 2</Title>
      </div>
      <div>
        <Title>Title 3</Title>
      </div>
    </MetaProvider>
  , div);
  expect(document.head.innerHTML).toBe(snapshot);
  dispose();
});

test('mounts and unmounts title', () => {
  let div = document.createElement("div");
  const snapshot1 = "<title>Static</title>";
  const snapshot2 = "<title>Dynamic</title>";
  const [visible, setVisible] = createSignal(false)
  const dispose = render(() =>
    <MetaProvider>
      <Title>Static</Title>
      <Show when={visible()}>
        <Title>Dynamic</Title>
      </Show>
    </MetaProvider>
  , div);

  expect(document.head.innerHTML).toBe(snapshot1);
  setVisible(true);
  expect(document.head.innerHTML).toBe(snapshot2);
  setVisible(false);
  expect(document.head.innerHTML).toBe(snapshot1);
  dispose();
});

test('switches between titles', () => {
  let div = document.createElement("div");
  const snapshot1 = "<title>Title 1</title>";
  const snapshot2 = "<title>Title 2</title>";
  const [visible, setVisible] = createSignal(true)
  const dispose = render(() =>
    <MetaProvider>
      <Title>Static</Title>
      <Show when={visible()} fallback={<Title>Title 2</Title>}>
        <Title>Title 1</Title>
      </Show>
    </MetaProvider>
  , div);
  expect(document.head.innerHTML).toBe(snapshot1);
  setVisible(false);
  expect(document.head.innerHTML).toBe(snapshot2);
  dispose();
});

test('renders only the last meta with the same name', () => {
  let div = document.createElement("div");

  /* Something weird in this env
  const snapshot1 = "<meta>Static 1</meta><meta name=\"name1\">Static 2</meta>";
  const snapshot2 = "<meta>Static 1</meta><meta name=\"name1\">Dynamic 1</meta>";
  const snapshot3 = "<meta>Dynamic 2</meta><meta name=\"name1\">Dynamic 1</meta>";
  */

  const snapshot1 = "<meta><meta name=\"name1\">";
  const snapshot2 = "<meta><meta name=\"name1\">";
  const snapshot3 = "<meta name=\"name1\"><meta>";
  const snapshot4 = "<meta name=\"name1\"><meta>";

  const [visible1, setVisible1] = createSignal(false);
  const [visible2, setVisible2] = createSignal(false);
  const dispose = render(() =>
    <MetaProvider>
      <Meta>Static 1</Meta>
      <Meta name="name1">Static 2</Meta>
      <Show when={visible1()}>
        <Meta name="name1">Dynamic 1</Meta>
      </Show>
      <Show when={visible2()}>
        <Meta>Dynamic 2</Meta>
      </Show>
    </MetaProvider>
  , div);
  expect(document.head.innerHTML).toBe(snapshot1);
  // mount first
  setVisible1(true);
  expect(document.head.innerHTML).toBe(snapshot2);
  // mount second
  setVisible2(true)
  expect(document.head.innerHTML).toBe(snapshot3);
  // unmount second
  setVisible2(false);
  expect(document.head.innerHTML).toBe(snapshot4);
  // unmount first
  setVisible1(false);
  expect(document.head.innerHTML).toBe(snapshot1);
  dispose();
});

test('renders only last meta with the same property', () => {
  let div = document.createElement("div");
  // something weird with meta tag stringification in this env
  const snapshot = "<meta property=\"name1\"><meta name=\"name2\"><meta property=\"name3\">";
  const dispose = render(() =>
    <MetaProvider>
      <Meta property="name1">Meta 1</Meta>
      <Meta property="name1">Meta 2</Meta>
      <Meta property="name2">Meta 3</Meta>
      <Meta name="name2">Meta 4</Meta>
      <Meta name="name3">Meta 5</Meta>
      <Meta property="name3">Meta 6</Meta>
    </MetaProvider>
  , div);
  expect(document.head.innerHTML).toBe(snapshot);
  dispose();
});

test('throws error if head tag is rendered without MetaProvider', () => {
  expect(() => {
    let div = document.createElement("div");
    render(() => <Style>{`body {}`}</Style>, div);
  }).toThrowError(/<MetaProvider \/> should be in the tree/);
});