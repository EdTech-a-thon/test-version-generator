import { Fragment, createElement } from "react";

const TAGS = [
  { pattern: /\^(.+?)\^/g, tag: "sup" },
  { pattern: /_(.+?)_/g, tag: "sub" },
];

export function renderMarkup(text: string | number | undefined | null) {
  if (text == null) return "";
  const raw = String(text);
  const tokens = parseTokens(raw);
  if (tokens.length === 1 && typeof tokens[0] === "string") return tokens[0];
  return createElement(Fragment, null, ...tokens.map((token, i) =>
    typeof token === "string" ? token : createElement(token.tag, { key: i }, token.text)
  ));
}

type Token = string | { tag: string; text: string };

function parseTokens(raw: string): Token[] {
  const matches: Array<{ start: number; end: number; tag: string; text: string }> = [];
  for (const { pattern, tag } of TAGS) {
    for (const match of raw.matchAll(pattern)) {
      matches.push({ start: match.index!, end: match.index! + match[0].length, tag, text: match[1] });
    }
  }
  if (!matches.length) return [raw];
  matches.sort((a, b) => a.start - b.start);

  const tokens: Token[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) tokens.push(raw.slice(cursor, match.start));
    tokens.push({ tag: match.tag, text: match.text });
    cursor = match.end;
  }
  if (cursor < raw.length) tokens.push(raw.slice(cursor));
  return tokens;
}