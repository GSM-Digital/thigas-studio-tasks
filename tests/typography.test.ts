// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("escala tipográfica acessível", () => {
  const stylesheet = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

  it("define os limites mínimos para desktop e mobile", () => {
    expect(stylesheet).toContain("--font-min: 14px");
    expect(stylesheet).toMatch(/@media \(max-width: 600px\)[\s\S]*?:root \{ --font-min: 13px; \}/);
  });

  it("protege toda declaração tipográfica menor com o token global", () => {
    const declarations = [...stylesheet.matchAll(/font-size:\s*([^;}]+)/g)].map((match) => match[1]!.trim());
    const unsafe = declarations.filter((value) => {
      if (value.includes("var(--font-min)")) return false;
      const pixels = [...value.matchAll(/([\d.]+)px/g)].map((match) => Number(match[1]));
      return pixels.some((size) => size < 14);
    });

    expect(unsafe).toEqual([]);
  });
});
