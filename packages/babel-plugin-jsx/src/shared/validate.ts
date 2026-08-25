import * as parse5 from "parse5";

type Document = parse5.DefaultTreeAdapterMap["document"];
type ParentNode = parse5.DefaultTreeAdapterMap["parentNode"];
type Element = parse5.DefaultTreeAdapterMap["element"];
type DocumentWithHtml = Document & { childNodes: [unknown, Element] };
type HtmlWithBody = Element & { childNodes: [unknown, Element] };

/** `bodyElement` will be used as a `context` (The place where we run `innerHTML`) */
const bodyElement = (
  (parse5.parse(`<!DOCTYPE html><html><head></head><body></body></html>`) as DocumentWithHtml)
    .childNodes[1] as HtmlWithBody
).childNodes[1];

function innerHTML(htmlFragment: string) {
  /** `htmlFragment` will be parsed as if it was set to the `bodyElement`'s `innerHTML` property. */
  const parsedFragment = parse5.parseFragment(bodyElement, htmlFragment, {});

  /** `serialize` returns back a string from the parsed nodes */
  return parse5.serialize(parsedFragment as ParentNode);
}

/**
 * Returns an object with information when the markup is invalid
 *
 * @param {string} html - The html string to validate
 * @returns {{
 *   html: string; // html stripped of attributives and content
 *   browser: string; // what the browser returned from evaluating `html`
 * } | null}
 */
export function isInvalidMarkup(html: string): { html: string; browser: string } | undefined {
  html = html

    // normalize dom-expressions comments, so comments location are also validated
    .replaceAll("<!>", "<!---->")
    .replaceAll("<!$>", "<!--$-->")
    .replaceAll("<!/>", "<!--/-->")

    // replace text nodes
    // text nodes are problematic, think "doesn't" vs "doesn&#39;t"
    // we can detect if text nodes were moved by the browser when the `#text` moves

    // replace text nodes that isnt in between tags by `#text`
    .replace(/^[^<]+/, "#text")
    .replace(/[^>]+$/, "#text")
    // replace text nodes in between tags by `#text`
    .replace(/>[^<]+</gi, ">#text<")

    // remove attributes (the lack of quotes will make it mismatch)
    // attributes are not longer added to `templateWithClosingTags`
    // https://github.com/solidjs/solid/issues/2338
    // .replace(/<([a-z0-9-:]+)\s+[^>]+>/gi, "<$1>")

    // fix escaping, so doesnt mess up the validation
    // `&lt;script>a();&lt;/script>` -> `&lt;script&gt;a();&lt;/script&gt;`
    .replace(/&lt;([^>]+)>/gi, "&lt;$1&gt;");

  // edge cases (safe to assume they will use the partial in the right place)

  // table cells
  if (/^<(td|th)>/.test(html)) {
    html = `<table><tbody><tr>${html}</tr></tbody></table>`;
  }

  // table rows
  if (/^<tr>/.test(html)) {
    html = `<table><tbody>${html}</tbody></table>`;
  }

  // table misc
  if (/^<col>/.test(html)) {
    html = `<table><colgroup>${html}</colgroup></table>`;
  }

  // table components
  if (/^<(thead|tbody|tfoot|colgroup|caption)>/.test(html)) {
    html = `<table>${html}</table>`;
  }

  // skip when equal to:
  switch (html) {
    // empty table components
    case "<table></table>":
    case "<table><thead></thead></table>":
    case "<table><tbody></tbody></table>":
    case "<table><thead></thead><tbody></tbody></table>": {
      return;
    }
  }

  /** Parse HTML. `browser` is a string with the supposed resulting html of a real `innerHTML` call */
  const browser = innerHTML(html);

  if (html.toLowerCase() !== browser.toLowerCase()) {
    return {
      html,
      browser
    };
  }
}
