/**
 * Note: These tests are purely compile time tests to ensure type consistency.
 * They are not executed by the test suite.
 */
import { render, For, Show, Switch, Match, Suspense, Portal } from '../../src/dom/index';
import { EventHandler } from '@jest/types/build/Circus';


function testFor() {
  () => {
    let forElement = (
      <For each={[1, 2, 3]}>{ (i: number, ii:number) =>
        <div>{i}</div>
      }</For>
    );
    // type assertions
    let forElementTypeAssert = forElement as JSX.Element;
    let forElementTypeAssertArray = forElement as JSX.Element[];
  }
}


function testShow() {
  () => {
    let showElement = (
      <Show when={true}>
        <div/>
      </Show>
    );
    // type assertions
    let showElementTypeAssert = showElement as JSX.Element;
  }
}


function testSwitchMatch() {
  () => {
    let matchElement = (
      <Match when={false}>
        <div/>
      </Match>
    );
    let matchElementTypeAssert = matchElement as JSX.Element;

    let switchElement = (
      <Switch>
        <Match when={true}>
          <div/>
        </Match>
        <Match when={false}>
          <div/>
        </Match>
        {matchElement}
      </Switch>
    );
    // type assertions
    let switchElementTypeAssert = switchElement as JSX.Element;
  }
}


function testSuspense() {
  () => {
    let suspenseElement = (
      <Suspense fallback={<div/>}>
        <div/>
      </Suspense>
    );
    // type assertions
    let suspenseElementTypeAssert = suspenseElement as JSX.Element;
  }
}


function testPortal() {
  () => {
    let portalElement = (
      <Portal>
        <div/>
      </Portal>
    );
    // type assertions
    let portalElementTypeAssert = portalElement as JSX.Element;
  }
}


function testFragment() {
  () => {
    let fragmentElement = <>
      <div />
      <div />
    </>
    // type assertions
    let fragmentElementTypeAssert = fragmentElement as JSX.Element;
  }
}


function testRefs() {
  () => {
    let simpleRef,
      forwardRef = (e: HTMLDivElement) => simpleRef = e,
      element = <div forwardRef={forwardRef} ref={simpleRef} />;
  }
}

function testSpreads() {
  () => {
    let simpleRef,
      forwardRef = (e: HTMLElement) => simpleRef = e,
      Component = (props: (JSX.HTMLAttributes<HTMLDivElement> & {ref?: (e: HTMLElement) => void})) => <div {...props} />,
      element = <Component forwardRef={forwardRef} onClick={() => console.log('Hi')} />;
  }
}


function testRender() {
  let dummyNode = document.getElementById("dummy")!;
  () => {
    render(() => <div/>, dummyNode);
    render(() => <For each={([])}>{() => <div/>}</For>, dummyNode);
    render(() => <Show when={true}><div/></Show>, dummyNode);
    render(() => <Switch><Match when={true}>{<div/>}</Match></Switch>, dummyNode);
    render(() => <Suspense fallback={Suspense}><div/></Suspense>, dummyNode);
    render(() => <Portal><div/></Portal>, dummyNode);
  }
}
