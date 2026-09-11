import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement, version } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RadiusGraph, mountRadiusGraph } from "@radius-project/graph-react";
import {
  buildGraph,
  resolveGraphSettings
} from "@radius-project/graph-react/presentation";
import {
  normalizeLiveGraph,
  graphContextKey
} from "@radius-project/core/graph";
import { parseResourceId } from "@radius-project/core/domain";

const require = createRequire(import.meta.url);
const context = {
  connectionId: "packed-consumer",
  plane: { type: "radius", name: "local" },
  applicationId:
    "/planes/radius/local/resourceGroups/demo/providers/Applications.Core/applications/demo"
};
const graph = normalizeLiveGraph({ resources: [] }, context);
assert.equal(graph.kind, "live");
assert.deepEqual(graph.resources, []);
assert.equal(parseResourceId(context.applicationId).name, "demo");
assert.equal(typeof graphContextKey(context), "string");
assert.throws(() => normalizeLiveGraph({}, context), /resources/);
assert.deepEqual(buildGraph(resolveGraphSettings(), []).nodes, []);
assert.equal(typeof mountRadiusGraph, "function");
assert.match(
  renderToStaticMarkup(createElement(RadiusGraph, { graph })),
  /radius-graph/
);
assert.equal(version, process.argv[2]);
for (const hidden of [
  "@radius-project/core",
  "@radius-project/core/modeling",
  "@radius-project/core/src/graph/index.ts",
  "@radius-project/graph-react/src/index.ts"
]) {
  assert.throws(() => require.resolve(hidden), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED"
  });
}
