const trailing = <span>Hello </span>;
const leading = <span> John</span>;

/* prettier-ignore */
const extraSpaces = <span>Hello   John</span>;

const trailingExpr = <span>Hello {name}</span>;
const leadingExpr = <span>{greeting} John</span>;

/* prettier-ignore */
const multiExpr = <span>{greeting} {name}</span>;

/* prettier-ignore */
const multiExprSpaced = <span> {greeting} {name} </span>;

/* prettier-ignore */
const multiExprTogether = <span> {greeting}{name} </span>;

/* prettier-ignore */
const multiLine = <span>

  Hello

</span>

/* prettier-ignore */
const multiLineTrailingSpace = <span>
  Hello 
  John
</span>

/* prettier-ignore */
const multiLineNoTrailingSpace = <span>
  Hello
  John
</span>

/* prettier-ignore */
const escape = <span> 
  &nbsp;&lt;Hi&gt;&nbsp;
</span>

/* prettier-ignore */
const escape2 = <Comp> 
  &nbsp;&lt;Hi&gt;&nbsp;
</Comp>

/* prettier-ignore */
const escape3 = <> 
  &nbsp;&lt;Hi&gt;&nbsp;
</>

const injection = <span>Hi{"<script>alert();</script>"}</span>;

let value = "World";
const evaluated = <span>Hello {value + "!"}</span>;

let number = 4 + 5;
const evaluatedNonString = <span>4 + 5 = {number}</span>;

const newLineLiteral = (
  <div>
    {s}
    {"\n"}d
  </div>
);

const trailingSpace = <div>{expr}</div>;

const trailingSpaceComp = <Comp>{expr}</Comp>;

const trailingSpaceFrag = <>{expr}</>;

const leadingSpaceElement = <span> {expr}</span>;

const leadingSpaceComponent = <Div> {expr}</Div>;

const leadingSpaceFragment = <> {expr}</>;

const trailingSpaceElement = <span>{expr} </span>;

const trailingSpaceComponent = <Div>{expr} </Div>;

const trailingSpaceFragment = <>{expr} </>;

const escapeAttribute = <div normal="Search&hellip;" title={"Search&hellip;"} />;

const escapeCompAttribute = <Div normal="Search&hellip;" title={"Search&hellip;"} />;

const lastElementExpression = (
  <div>
    <div></div>
    {expr()}
  </div>
);

const nonAsciiText = (
  <p title="Next →">
    Next → <style>{'.a::after{content:"→"}'}</style>
  </p>
);
const nonAsciiSpreadTail = <a {...spread} title="Next →" data-static="é" />;
const nonAsciiCustomElement = <style-guide>Next →</style-guide>;
const nonAsciiSpreadStyle = <style {...spread}>{'.a::after{content:"→"}'}</style>;
const nonAsciiScriptture = <script>{'x = "</scripture>→";'}</script>;
const latin1AndC1 = <p title="café">{"café \u0080\u0091"}</p>;
const nonAsciiSpreadXmp = <xmp {...spread}>{"→"}</xmp>;
const nonAsciiEscapedScript = <script>{'h = "<!--<script></script>→";'}</script>;
const nonAsciiCdata = (
  <svg>
    <text innerHTML={"<![CDATA[→]]>"} />
  </svg>
);
