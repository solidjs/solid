const staticValue = <div data={<span>static</span>}>after</div>;

const dynamicValue = <div data={<span>{state.value}</span>}>after</div>;

const iifeValue = <div data={(() => state.compute())()} />;

const multiValues = (
  <div first={<span>{state.first}</span>} second={<label>{state.second}</label>} />
);

const handlerValue = <button onClick={() => mount(<div>content</div>)}>go</button>;

const refValue = <div ref={el => el.appendChild(<span>own</span>)} />;

const spreadValue = <div {...props} data={<span>{state.value}</span>} />;

const propValue = (
  <div>
    <Comp fallback={<h1>fallback</h1>} />
  </div>
);
