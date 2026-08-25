import { describe, expect, it } from "vitest";
import {
  CLOSE_TAG_TOKEN,
  EQUALS_TOKEN,
  EXPRESSION_TOKEN,
  IDENTIFIER_TOKEN,
  OPEN_TAG_TOKEN,
  SLASH_TOKEN,
  STRING_TOKEN,
  TEXT_TOKEN,
  tokenize
} from "../src/tokenize.js";
import { RawTextElements } from "./html-test-constants.js";

function tokenizeTemplate(strings: TemplateStringsArray, ...values: any[]) {
  return tokenize(strings, RawTextElements);
}

describe("basic tags", () => {
  it("should tokenize opening tag", () => {
    const tokens = tokenizeTemplate`<div`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      }
    ]);
  });

  it("should tokenize complete tag", () => {
    const tokens = tokenizeTemplate`<div>`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should tokenize self-closing tag", () => {
    const tokens = tokenizeTemplate`<div />`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: SLASH_TOKEN
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should tokenize opening and closing tag", () => {
    const tokens = tokenizeTemplate`<div></div>`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: CLOSE_TAG_TOKEN
      },
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: SLASH_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },

      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });
});

describe("attribute values", () => {
  it("should tokenize quoted string", () => {
    const tokens = tokenizeTemplate`<div id="hello">`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "id"
      },
      {
        type: EQUALS_TOKEN
      },
      {
        type: STRING_TOKEN,
        value: "hello",
        quote: '"'
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should tokenize single quoted string", () => {
    const tokens = tokenizeTemplate`<div id='hello'>`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "id"
      },
      {
        type: EQUALS_TOKEN
      },
      {
        type: STRING_TOKEN,
        value: "hello",
        quote: "'"
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should handle empty quoted string", () => {
    const tokens = tokenizeTemplate`<div class="">`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "class"
      },
      {
        type: EQUALS_TOKEN
      },
      {
        type: STRING_TOKEN,
        value: "",
        quote: '"'
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should handle boolean like attribute", () => {
    const tokens = tokenizeTemplate`<div enabled bool>`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "enabled"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "bool"
      },

      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should handle deeply nested quotes", () => {
    const tokens = tokenizeTemplate`<div data="value with 'nested' quotes">`;

    expect(tokens).toContainEqual(
      expect.objectContaining({
        type: STRING_TOKEN,
        value: "value with 'nested' quotes",
        quote: '"'
      })
    );
  });

  it("should handle attribute values with special characters", () => {
    const tokens = tokenizeTemplate`<div data="!@#$%^&*()_+-=[]{}|;:,.<>?">`;

    expect(tokens).toContainEqual(
      expect.objectContaining({
        type: STRING_TOKEN,
        value: "!@#$%^&*()_+-=[]{}|;:,.<>?",
        quote: '"'
      })
    );
  });

  it("should handle URL-like attribute values", () => {
    const tokens = tokenizeTemplate`<a href="https://example.com/path?query=value&other=test#section">`;

    expect(tokens).toContainEqual(
      expect.objectContaining({
        type: STRING_TOKEN,
        value: "https://example.com/path?query=value&other=test#section",
        quote: '"'
      })
    );
  });

  it("attribute name doesnt trigger raw text", () => {
    const tokens = tokenizeTemplate`
            <h1 title=""></h1>
          `;

    expect(tokens).toEqual([
      { type: TEXT_TOKEN, value: "\n            " },
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "h1" },
      { type: IDENTIFIER_TOKEN, value: "title" },
      { type: EQUALS_TOKEN },
      { type: STRING_TOKEN, value: "", quote: '"' },

      { type: CLOSE_TAG_TOKEN },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "h1" },
      { type: CLOSE_TAG_TOKEN },
      { type: TEXT_TOKEN, value: "\n          " }
    ]);
  });
});

describe("expressions", () => {
  it("should tokenize simple expression", () => {
    const value = "test";
    const tokens = tokenizeTemplate`${value}`;

    expect(tokens).toEqual([
      {
        type: EXPRESSION_TOKEN,
        value: 0
      }
    ]);
  });

  it("should tokenize multiple expressions", () => {
    const a = "first";
    const b = "second";
    const tokens = tokenizeTemplate`${a}${b}`;

    expect(tokens).toEqual([
      {
        type: EXPRESSION_TOKEN,
        value: 0
      },
      {
        type: EXPRESSION_TOKEN,
        value: 1
      }
    ]);
  });

  it("should handle expression in unquoted attribute", () => {
    const id = "my-id";
    const tokens = tokenizeTemplate`<div id=${id}>`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "id"
      },
      {
        type: EQUALS_TOKEN
      },
      {
        type: EXPRESSION_TOKEN,
        value: 0
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should handle mixed text and expressions", () => {
    const name = "World";
    const tokens = tokenizeTemplate`Hello ${name}!`;

    expect(tokens).toEqual([
      {
        type: TEXT_TOKEN,
        value: "Hello "
      },
      {
        type: EXPRESSION_TOKEN,
        value: 0
      },
      {
        type: TEXT_TOKEN,
        value: "!"
      }
    ]);
  });

  it("should handle data attributes with hyphens and underscores", () => {
    const tokens = tokenizeTemplate`<div data-my_value="test" data_other-name="value">`;

    const attrNames = tokens.filter(
      t => t.type === IDENTIFIER_TOKEN && (t.value as string).includes("data")
    );
    expect(attrNames.length).toBeGreaterThanOrEqual(2);
  });
});

describe("whitespace handling", () => {
  it("should skip whitespace inside tags", () => {
    const tokens = tokenizeTemplate`< \n  div   id   =   "app"  >`;

    // Should not have whitespace tokens in tag context
    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "id"
      },
      {
        type: EQUALS_TOKEN
      },

      {
        type: STRING_TOKEN,
        value: "app",
        quote: '"'
      },

      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should preserve text content whitespace", () => {
    const tokens = tokenizeTemplate`  Hello World  `;

    expect(tokens).toEqual([
      {
        type: TEXT_TOKEN,
        value: "  Hello World  "
      }
    ]);
  });

  it("should handle multiline content with preserved whitespace", () => {
    const tokens = tokenizeTemplate`<div>
        Hello
      </div>`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: CLOSE_TAG_TOKEN
      },
      {
        type: TEXT_TOKEN,
        value: "\n        Hello\n      "
      },
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: SLASH_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should handle tabs and mixed whitespace", () => {
    const tokens = tokenizeTemplate`\tHello\nWorld `;

    expect(tokens).toEqual([
      {
        type: TEXT_TOKEN,
        value: "\tHello\nWorld "
      }
    ]);
  });

  it("should handle whitespace around expressions", () => {
    const name = "test";
    const tokens = tokenizeTemplate`  ${name}  `;

    expect(tokens).toEqual([
      {
        type: TEXT_TOKEN,
        value: "  "
      },
      {
        type: EXPRESSION_TOKEN,
        value: 0
      },
      {
        type: TEXT_TOKEN,
        value: "  "
      }
    ]);
  });
});

describe("edge cases", () => {
  it("should handle empty template", () => {
    const tokens = tokenizeTemplate``;

    expect(tokens).toEqual([]);
  });

  it("should handle only whitespace", () => {
    const tokens = tokenizeTemplate`   `;

    expect(tokens).toEqual([
      {
        type: TEXT_TOKEN,
        value: "   "
      }
    ]);
  });

  it("should handle special characters in text", () => {
    const tokens = tokenizeTemplate`Hello & goodbye`;

    expect(tokens).toEqual([
      {
        type: TEXT_TOKEN,
        value: "Hello & goodbye"
      }
    ]);
  });

  it("should handle consecutive expressions", () => {
    const a = "first";
    const b = "second";
    const tokens = tokenizeTemplate`${a}${b}`;

    expect(tokens).toEqual([
      {
        type: EXPRESSION_TOKEN,
        value: 0
      },
      {
        type: EXPRESSION_TOKEN,
        value: 1
      }
    ]);
  });

  it("should handle 1 letter tags", () => {
    const tokens = tokenizeTemplate`<tr class=${0}>
                  <td class="col-md-1" textContent=${1} />
                  <td class="col-md-4">
                    <a onClick=${2} textContent=${3} />
                  </td>
                  <td class="col-md-1">
                    <a onClick=${4}>
                      <span class="glyphicon glyphicon-remove" aria-hidden="true" />
                    </a>
                  </td>
                  <td class="col-md-6" />
                </tr>`;
    expect(tokens.filter(t => t.type === IDENTIFIER_TOKEN && t.value === "a").length).toBe(3);
  });
});

describe("special characters in names", () => {
  it("should tokenize tag with hyphens", () => {
    const tokens = tokenizeTemplate`<my-component />`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "my-component"
      },
      {
        type: SLASH_TOKEN
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should tokenize tag with periods", () => {
    const tokens = tokenizeTemplate`<my.component />`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "my.component"
      },
      {
        type: SLASH_TOKEN
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should tokenize tag with colons", () => {
    const tokens = tokenizeTemplate`<svg:rect />`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "svg:rect"
      },
      {
        type: SLASH_TOKEN
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should tokenize tag with underscores", () => {
    const tokens = tokenizeTemplate`<my_component />`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "my_component"
      },
      {
        type: SLASH_TOKEN
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });

  it("should tokenize attribute with -_.:$", () => {
    const tokens = tokenizeTemplate`<div data-id data_id data.id data:id dataid$>`;

    expect(tokens).toEqual([
      {
        type: OPEN_TAG_TOKEN
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "div"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "data-id"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "data_id"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "data.id"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "data:id"
      },
      {
        type: IDENTIFIER_TOKEN,
        value: "dataid$"
      },
      {
        type: CLOSE_TAG_TOKEN
      }
    ]);
  });
});

describe("invalid syntax", () => {
  it("should throw with extra <", () => {
    expect(() => tokenizeTemplate`<<div / >`).toThrow();
  });

  it("should throw with extra <", () => {
    expect(() => tokenizeTemplate`<div / <>`).toThrow();
  });

  it("should throw on invalid identofier", () => {
    expect(() => tokenizeTemplate`<.div />`).toThrow();
  });

  it("should throw on invalid identofier", () => {
    expect(() => tokenizeTemplate`<div @fa />`).toThrow();
  });

  it("should throw on invalid identofier", () => {
    expect(() => tokenizeTemplate`<div 0fa />`).toThrow();
  });
});

describe("bad but valid syntaxes", () => {
  it("should handle multiple attributes in tight syntax", () => {
    const tokens = tokenizeTemplate`<div a="1"b="2"c="3">`;

    const attrNames = tokens.filter(
      t => t.type === IDENTIFIER_TOKEN && t.value && /^[abc]$/.test(t.value as string)
    );
    expect(attrNames).toHaveLength(3);
  });

  it("should handle attribute without value but with slash", () => {
    const tokens = tokenizeTemplate`<div required/>`;

    expect(tokens).toContainEqual(
      expect.objectContaining({
        type: IDENTIFIER_TOKEN,
        value: "required"
      })
    );
    expect(tokens).toContainEqual(
      expect.objectContaining({
        type: SLASH_TOKEN
      })
    );
  });

  it("should handle whitespace variations", () => {
    const tokens = tokenizeTemplate`<div   id   =   "value"   />`;

    expect(tokens).toContainEqual(
      expect.objectContaining({
        type: IDENTIFIER_TOKEN,
        value: "id"
      })
    );
    expect(tokens).toContainEqual(
      expect.objectContaining({
        type: STRING_TOKEN,
        value: "value"
      })
    );
  });
});

describe("handling of raw text elements", () => {
  it("should tokenize content inside <script> as text", () => {
    const tokens = tokenizeTemplate`<script>const a = 5<10;</script>`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "script" },
      { type: CLOSE_TAG_TOKEN },
      { type: TEXT_TOKEN, value: "const a = 5<10;" },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "script" },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should tokenize content inside <style> as text", () => {
    const tokens = tokenizeTemplate`<style>.class > span { color: red; }</style>`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "style" },
      { type: CLOSE_TAG_TOKEN },
      { type: TEXT_TOKEN, value: ".class > span { color: red; }" },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "style" },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should handle nested raw text elements ", () => {
    const tokens = tokenizeTemplate`<div><style>.class > span { color: red; }</style></div>`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "div" },
      { type: CLOSE_TAG_TOKEN },
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "style" },
      { type: CLOSE_TAG_TOKEN },
      { type: TEXT_TOKEN, value: ".class > span { color: red; }" },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "style" },
      { type: CLOSE_TAG_TOKEN },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "div" },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should tokenize content inside <textarea> as text", () => {
    const tokens = tokenizeTemplate`<textarea>This is <span>not parsed</span>.</textarea>`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "textarea" },
      { type: CLOSE_TAG_TOKEN },
      { type: TEXT_TOKEN, value: "This is <span>not parsed</span>." },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "textarea" },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should handle raw text elements with attributes and expressions", () => {
    const tokens = tokenizeTemplate`<textarea type=${0}><span>${1}</span></textarea>`;
    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "textarea" },
      { type: IDENTIFIER_TOKEN, value: "type" },
      { type: EQUALS_TOKEN },
      { type: EXPRESSION_TOKEN, value: 0 },
      { type: CLOSE_TAG_TOKEN },
      { type: TEXT_TOKEN, value: "<span>" },
      { type: EXPRESSION_TOKEN, value: 1 },
      { type: TEXT_TOKEN, value: "</span>" },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "textarea" },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should handle raw text elements and white space in tags", () => {
    const tokens = tokenizeTemplate`<   textarea  >  ${0}<  /   textarea   >`;
    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "textarea" },
      { type: CLOSE_TAG_TOKEN },
      { type: TEXT_TOKEN, value: `  ` },
      { type: EXPRESSION_TOKEN, value: 0 },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "textarea" },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should handle nested raw text elements", () => {
    const tokens = tokenizeTemplate`<textarea><textarea>const a = 5;</textarea></textarea>`;
    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "textarea" },
      { type: CLOSE_TAG_TOKEN },
      { type: TEXT_TOKEN, value: "<textarea>const a = 5;" },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "textarea" },
      { type: CLOSE_TAG_TOKEN },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "textarea" },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should handle self-closing raw text elements", () => {
    const tokens = tokenizeTemplate`<textarea ${0} />Text`;
    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "textarea" },
      { type: EXPRESSION_TOKEN, value: 0 },
      { type: SLASH_TOKEN },
      { type: CLOSE_TAG_TOKEN },
      { type: TEXT_TOKEN, value: "Text" }
    ]);
  });
});

describe("dynamic component tags", () => {
  it("should tokenize dynamic opening tag with expression", () => {
    const Comp = "Comp";
    const tokens = tokenizeTemplate`<${Comp}>`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: EXPRESSION_TOKEN, value: 0 },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should tokenize dynamic self-closing tag", () => {
    const Comp = "Comp";
    const tokens = tokenizeTemplate`<${Comp} />`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: EXPRESSION_TOKEN, value: 0 },
      { type: SLASH_TOKEN },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should tokenize dynamic closing tag", () => {
    const Comp = "Comp";
    const tokens = tokenizeTemplate`<${Comp}></${Comp}>`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: EXPRESSION_TOKEN, value: 0 },
      { type: CLOSE_TAG_TOKEN },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: EXPRESSION_TOKEN, value: 1 },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should tokenize shorthand close tag", () => {
    const tokens = tokenizeTemplate`<Comp>content<//>`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "Comp" },
      { type: CLOSE_TAG_TOKEN },
      { type: TEXT_TOKEN, value: "content" },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: SLASH_TOKEN },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should tokenize dynamic tag with attributes", () => {
    const Comp = "Comp";
    const tokens = tokenizeTemplate`<${Comp} id="test" />`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: EXPRESSION_TOKEN, value: 0 },
      { type: IDENTIFIER_TOKEN, value: "id" },
      { type: EQUALS_TOKEN },
      { type: STRING_TOKEN, value: "test", quote: '"' },
      { type: SLASH_TOKEN },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });
});

describe("comments handling", () => {
  it("should not tokenize comments", () => {
    const tokens = tokenizeTemplate`<div><!-- This is a comment --></div>`;
    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "div" },
      { type: CLOSE_TAG_TOKEN },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "div" },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should handle comments with special characters", () => {
    const tokens = tokenizeTemplate`<!-- Special chars: <>&'" -->`;
    expect(tokens).toEqual([]);
  });

  it("should handle comments with expressions inside", () => {
    const value = "test";
    const tokens = tokenizeTemplate`<!-- Comment with ${value} inside -->`;
    expect(tokens).toEqual([]);
  });

  it("should skip line comments in tags", () => {
    const tokens = tokenizeTemplate`<button
      disabled//comment
      //handle with expression=${1}
      class="btn"
    />`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "button" },
      { type: IDENTIFIER_TOKEN, value: "disabled" },
      { type: IDENTIFIER_TOKEN, value: "class" },
      { type: EQUALS_TOKEN },
      { type: STRING_TOKEN, value: "btn", quote: '"' },
      { type: SLASH_TOKEN },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should skip line comments before the tag name", () => {
    const tokens = tokenizeTemplate`<
      //comment
      button
    />`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "button" },
      { type: SLASH_TOKEN },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should keep shorthand closing tags", () => {
    const tokens = tokenizeTemplate`<${0}>Text<//>`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: EXPRESSION_TOKEN, value: 0 },
      { type: CLOSE_TAG_TOKEN },
      { type: TEXT_TOKEN, value: "Text" },
      { type: OPEN_TAG_TOKEN },
      { type: SLASH_TOKEN },
      { type: SLASH_TOKEN },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });

  it("should skip block comments in tags", () => {
    const tokens = tokenizeTemplate`<button
      disabled /*comment
      //handle with expression=${1}
      */class="btn"
    />`;

    expect(tokens).toEqual([
      { type: OPEN_TAG_TOKEN },
      { type: IDENTIFIER_TOKEN, value: "button" },
      { type: IDENTIFIER_TOKEN, value: "disabled" },
      { type: IDENTIFIER_TOKEN, value: "class" },
      { type: EQUALS_TOKEN },
      { type: STRING_TOKEN, value: "btn", quote: '"' },
      { type: SLASH_TOKEN },
      { type: CLOSE_TAG_TOKEN }
    ]);
  });
});
