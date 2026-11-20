const template = (
  <div id="main">
    <style>{"div { color: red; }"}</style>
    <h1>Welcome</h1>
    <label for={"entry"}>Edit:</label>
    <input id="entry" type="text" />
    {/* Comment Node */}
  </div>
);

const template2 = (
  <div>
    <span>
      <a></a>
    </span>
    <span />
  </div>
);

const template3 = (
  <div>
    <div>
      <table>
        <tbody></tbody>
      </table>
    </div>
    <div></div>
  </div>
);

const template4 = (
  <div>
    <div>
      <footer>
        <div />
      </footer>
    </div>
    <div>
      <button>
        <span>{0}</span>
      </button>
    </div>
  </div>
);

const template5 = (
  <div>
    <noscript>
      No JS!!
      <style>{"div { color: red; }"}</style>
    </noscript>
  </div>
);

const template6 = (
  <noscript>
    <iframe src={trackingUrl()} height="0" width="0" />
  </noscript>
);

const template7 = (
  <div>
    <noscript data-id={id()}>
      <a href="/fallback" aria-label={label()}>
        Fallback
      </a>
    </noscript>
  </div>
);
