const multiStatic = (
  <>
    <div>First</div>
    <div>Last</div>
  </>
);

const multiExpression = (
  <>
    <div>First</div>
    {inserted}
    <div>Last</div>
    After
  </>
);

const multiDynamic = (
  <>
    <div id={state.first}>First</div>
    {state.inserted}
    <div id={state.last}>Last</div>
    After
  </>
);

const singleExpression = <>{inserted}</>;

const singleDynamic = <>{inserted()}</>;

const firstStatic = (
  <>
    {inserted}
    <div />
  </>
);

const firstDynamic = (
  <>
    {inserted()}
    <div />
  </>
);

const firstComponent = (
  <>
    <Component />
    <div />
  </>
);

const lastStatic = (
  <>
    <div />
    {inserted}
  </>
);

const lastDynamic = (
  <>
    <div />
    {inserted()}
  </>
);

const lastComponent = (
  <>
    <div />
    <Component />
  </>
);

const spaces = (
  <>
    <span>1</span> <span>2</span> <span>3</span>
  </>
);
const multiLineTrailing = (
  <>
    <span>1</span>
    <span>2</span>
    <span>3</span>
  </>
);

const groupedAroundExpression = (
  <>
    <header>First</header>
    <div>Second</div>
    {inserted}
    <span>Third</span>
    <footer>Fourth</footer>
  </>
);

const adjacentDynamicRoots = (
  <>
    <div id={state.first}>First</div>
    <div id={state.last}>Last</div>
  </>
);

const adjacentVoidRoots = (
  <>
    <input />
    <img />
  </>
);

const adjacentImportRoots = (
  <>
    <img loading="lazy" />
    <iframe loading="lazy" />
  </>
);
