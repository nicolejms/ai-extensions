import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./plugins.mjs";

export const scopedFlowStylesPath = join(
  repoRoot,
  "packages",
  "graph-react",
  "src",
  "flow.css"
);

export function scopeFlowStyles(css, license) {
  assert.doesNotMatch(css, /@(?:import|font-face)\b/);
  return `/*!
Generated from reactflow@11.11.4 by scripts/graph-vendor-styles.mjs.
Do not edit: regenerate after reviewing a vendor update.

${license.trim()}
*/
@scope (.radius-graph) {
${css.trim().replaceAll("dashdraw", "radius-graph-dashdraw")}
}
`;
}

export function expectedScopedFlowStyles() {
  const fromGraph = createRequire(
    join(repoRoot, "packages", "graph-react", "package.json")
  );
  const cssPath = fromGraph.resolve("reactflow/dist/style.css");
  const root = resolve(dirname(cssPath), "..");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.version, "11.11.4");
  return scopeFlowStyles(
    readFileSync(cssPath, "utf8"),
    readFileSync(join(root, "LICENSE"), "utf8")
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const expected = expectedScopedFlowStyles();
  if (process.argv[2] === "--check") {
    assert.equal(readFileSync(scopedFlowStylesPath, "utf8"), expected);
  } else {
    assert.equal(process.argv.length, 2, "Use no arguments or --check.");
    writeFileSync(scopedFlowStylesPath, expected);
  }
}
