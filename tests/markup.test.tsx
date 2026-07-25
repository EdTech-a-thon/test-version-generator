import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { renderMarkup } from "@/lib/render-markup";

describe("renderMarkup", () => {
  it("returns plain string unchanged", () => {
    const result = renderMarkup("Hello world");
    expect(result).toBe("Hello world");
  });

  it("returns empty string for null/undefined", () => {
    expect(renderMarkup(null)).toBe("");
    expect(renderMarkup(undefined)).toBe("");
  });

  it("converts numbers to strings", () => {
    expect(renderMarkup(42)).toBe("42");
  });

  it("renders superscript from ^text^", () => {
    const result = renderMarkup("3.0x10^8^ m/s");
    const html = renderToString(<div>{result}</div>);
    expect(html).toContain("<sup>8</sup>");
    expect(html).toContain("3.0x10");
  });

  it("renders subscript from _text_", () => {
    const result = renderMarkup("C_2_H_4_");
    const html = renderToString(<div>{result}</div>);
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sub>4</sub>");
  });

  it("handles mixed superscript and subscript", () => {
    const result = renderMarkup("H_2_O and 10^3^ m");
    const html = renderToString(<div>{result}</div>);
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>3</sup>");
  });

  it("handles multiple of same type", () => {
    const result = renderMarkup("a^1^ b^2^ c^3^");
    const html = renderToString(<div>{result}</div>);
    const matches = html.match(/<sup>/g);
    expect(matches?.length).toBe(3);
  });

  it("handles adjacent markup without separating spaces", () => {
    const result = renderMarkup("a^1^_2_");
    const html = renderToString(<div>{result}</div>);
    expect(html).toContain("<sup>1</sup>");
    expect(html).toContain("<sub>2</sub>");
  });

  it("plain numbers inside text are not treated as markup", () => {
    const result = renderMarkup("x = 42");
    expect(result).toBe("x = 42");
  });
});