// Per-slot `<!>` insertion markers × omitLastClosingTag: an element followed
// by multiple dynamic slots must keep its closing tag, or the trailing
// placeholders parse as its children and corrupt the template walk.
const trailingSlotsAfterElement = (
  <div>
    <span>static</span>
    {a()}
    {b()}
  </div>
);

const trailingComponentAndSlot = (
  <div>
    <span>static</span>
    <Comp />
    {b()}
  </div>
);

const nestedParent = (
  <div>
    <header>
      <span>static</span>
      {a()}
      {b()}
    </header>
  </div>
);

// Safe omissions that must be preserved:
const slotsBeforeElement = (
  <div>
    {a()}
    {b()}
    <span>static</span>
  </div>
);

const singleTrailingSlot = (
  <div>
    <span>static</span>
    {a()}
  </div>
);
