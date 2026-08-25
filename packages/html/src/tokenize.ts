export const OPEN_TAG_TOKEN = 0;
export const CLOSE_TAG_TOKEN = 1;
export const SLASH_TOKEN = 2;
export const IDENTIFIER_TOKEN = 3;
export const EQUALS_TOKEN = 4;
export const STRING_TOKEN = 5;
export const TEXT_TOKEN = 6;
export const EXPRESSION_TOKEN = 7;
export const SPREAD_TOKEN = 8;

const isIdentifierChar = (code: number): boolean => {
  return (
    isIdentifierStart(code) ||
    (code >= 48 && code <= 58) || // 0-9, :
    code === 46 || // .
    code === 45 // -
  );
};

const isIdentifierStart = (code: number): boolean => {
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 || // _
    code === 36 // $
  );
};

const isWhitespace = (code: number): boolean => {
  return (code >= 9 && code <= 13) || code === 32; // \t \n \v \f \r space
};

export interface OpenTagToken {
  type: typeof OPEN_TAG_TOKEN;
  // value: "<";
}

export interface CloseTagToken {
  type: typeof CLOSE_TAG_TOKEN;
  // value: ">";
}

export interface SlashToken {
  type: typeof SLASH_TOKEN;
  // value: "/";
}

export interface IdentifierToken {
  type: typeof IDENTIFIER_TOKEN;
  value: string;
}

export interface EqualsToken {
  type: typeof EQUALS_TOKEN;
  // value: "=";
}

export interface StringToken {
  type: typeof STRING_TOKEN;
  value: string;
  quote: "'" | '"';
}

export interface TextToken {
  type: typeof TEXT_TOKEN;
  value: string;
}

export interface SpreadToken {
  type: typeof SPREAD_TOKEN;
  // value: "..."
}

export interface ExpressionToken {
  type: typeof EXPRESSION_TOKEN;
  value: number;
}

export type Token =
  | OpenTagToken
  | CloseTagToken
  | SlashToken
  | IdentifierToken
  | EqualsToken
  | StringToken
  | TextToken
  | ExpressionToken
  // | QuoteToken
  | SpreadToken;

// Add a new state for elements that contain raw text only
const STATE_TEXT = 0;
const STATE_TAG = 1;
const STATE_RAW_TEXT = 2;
const STATE_COMMENT = 3;
const STATE_LINE_COMMENT = 4;
const STATE_BLOCK_COMMENT = 5;

export const tokenize = (
  strings: TemplateStringsArray | string[],
  rawTextElements: Set<string>
): Token[] => {
  const tokens: Token[] = [];
  let state = STATE_TEXT;
  let lastTagName = "";
  let cursor = 0;

  for (let i = 0; i < strings.length; i++) {
    const str = strings[i];
    const len = str.length;
    cursor = 0;

    while (cursor < len) {
      switch (state) {
        case STATE_TEXT: {
          lastTagName = "";
          const nextTag = str.indexOf("<", cursor);
          if (nextTag === -1) {
            if (cursor < len) tokens.push({ type: TEXT_TOKEN, value: str.slice(cursor) });
            cursor = len;
          } else {
            if (nextTag > cursor)
              tokens.push({
                type: TEXT_TOKEN,
                value: str.slice(cursor, nextTag)
              });

            if (str[nextTag + 1] === "!" && str[nextTag + 2] === "-" && str[nextTag + 3] === "-") {
              state = STATE_COMMENT;
              cursor = nextTag + 4;
            } else {
              tokens.push({ type: OPEN_TAG_TOKEN });
              state = STATE_TAG;
              cursor = nextTag + 1;
            }
          }
          break;
        }
        case STATE_TAG: {
          const code = str.charCodeAt(cursor);

          if (isWhitespace(code)) {
            cursor++;
          } else if (code === 62) {
            // ">"
            if (
              rawTextElements.has(lastTagName) &&
              tokens[tokens.length - 2]?.type !== SLASH_TOKEN
            ) {
              state = STATE_RAW_TEXT;
            } else {
              state = STATE_TEXT;
              lastTagName = "";
            }
            tokens.push({ type: CLOSE_TAG_TOKEN });

            cursor++;
          } else if (code === 61) {
            // "="
            tokens.push({ type: EQUALS_TOKEN });
            cursor++;
          } else if (code === 47) {
            // "/"
            const next = str.charCodeAt(cursor + 1);
            const nextNonWhitespace = str.slice(cursor + 2).search(/\S/);
            const isShorthandClosingTag =
              next === 47 &&
              tokens[tokens.length - 1]?.type === OPEN_TAG_TOKEN &&
              nextNonWhitespace !== -1 &&
              str[cursor + 2 + nextNonWhitespace] === ">";

            if (next === 47 && !isShorthandClosingTag) {
              state = STATE_LINE_COMMENT;
            } else if (next === 42) {
              state = STATE_BLOCK_COMMENT;
            } else {
              tokens.push({ type: SLASH_TOKEN });
              cursor++;
            }
          } else if (code === 34 || code === 39) {
            const char = str[cursor] as "'" | '"';
            const endQuoteIndex = str.indexOf(char, cursor + 1);

            if (endQuoteIndex === -1) {
              throw new Error(`Unterminated string at ${i}:${cursor}`);
            }
            tokens.push({
              type: STRING_TOKEN,
              value: str.slice(cursor + 1, endQuoteIndex),
              quote: char
            });
            cursor = endQuoteIndex + 1;
          } else if (isIdentifierStart(code)) {
            const start = cursor;
            while (cursor < len && isIdentifierChar(str.charCodeAt(cursor))) cursor++;
            const value = str.slice(start, cursor);
            if (lastTagName === "") {
              lastTagName = value;
            }
            tokens.push({ type: IDENTIFIER_TOKEN, value });
          } else if (code === 46 && str[cursor + 1] === "." && str[cursor + 2] === ".") {
            // "."
            tokens.push({ type: SPREAD_TOKEN });
            cursor += 3;
          } else {
            throw new Error(`Unexpected Character: ${str[cursor]} at ${i}:${cursor}`);
          }
          break;
        }
        case STATE_RAW_TEXT: {
          // Case-sensitive search for the specific closing tag with optional whitespace in between, e.g. < / textarea >
          const closeTagRegex = new RegExp(`<\\s*/\\s*${lastTagName}\\s*>`, "g");
          closeTagRegex.lastIndex = cursor;
          const match = closeTagRegex.exec(str);

          if (match) {
            const endOfRawIdx = match.index;
            if (endOfRawIdx > cursor) {
              tokens.push({
                type: TEXT_TOKEN,
                value: str.slice(cursor, endOfRawIdx)
              });
            }
            state = STATE_TEXT;
            cursor = endOfRawIdx;
            lastTagName = "";
          } else {
            tokens.push({ type: TEXT_TOKEN, value: str.slice(cursor) });
            cursor = len;
          }
          break;
        }
        case STATE_COMMENT:
        case STATE_LINE_COMMENT:
        case STATE_BLOCK_COMMENT: {
          const commentEnd =
            state === STATE_LINE_COMMENT ? "\n" : state === STATE_BLOCK_COMMENT ? "*/" : "-->";
          const commentEndIndex = str.indexOf(commentEnd, cursor);

          if (commentEndIndex === -1) {
            // If we don't find the closer in this string chunk, consume the rest and stay in the comment.
            cursor = len;
          } else {
            state = state === STATE_COMMENT ? STATE_TEXT : STATE_TAG;
            cursor = commentEndIndex + commentEnd.length;
          }
          break;
        }
      }
    }

    if (i < strings.length - 1) {
      if (state === STATE_TEXT || state === STATE_TAG || state === STATE_RAW_TEXT) {
        tokens.push({ type: EXPRESSION_TOKEN, value: i });
      }
    }
  }

  return tokens;
};
