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
const multiLine = <span>

  Hello

</span>

/* prettier-ignore */
const multiLineTrailingSpace = <span>
  Hello 
  John
</span>

/* prettier-ignore */
const escape = <span>
  &nbsp;&lt;Hi&gt;&nbsp;
</span>
