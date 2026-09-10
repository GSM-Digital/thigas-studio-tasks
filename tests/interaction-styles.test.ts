// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("microinterações dos controles de edição", () => {
  const stylesheet = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

  it("usa controles alinhados e com área de clique consistente", () => {
    expect(stylesheet).toMatch(/\.inline-edit-action \{[^}]*width: 34px;[^}]*height: 34px;[^}]*place-items: center/);
    expect(stylesheet).toMatch(/\.inline-edit-action svg \{[^}]*width: 16px;[^}]*height: 16px/);
  });

  it("diferencia confirmação verde e cancelamento vermelho no hover e no foco", () => {
    expect(stylesheet).toMatch(/\.inline-edit-action\.confirm:hover[^}]*color: var\(--green\)/);
    expect(stylesheet).toMatch(/\.inline-edit-action\.cancel:hover[^}]*color: #ff453a/);
    expect(stylesheet).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
