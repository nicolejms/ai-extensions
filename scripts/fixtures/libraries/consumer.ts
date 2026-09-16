import { createElement } from "react";
import { RadiusGraph, mountRadiusGraph } from "@radius-project/graph-react";
import type { GraphStyle, RadiusGraphProps } from "@radius-project/graph-react";
import {
  buildGraph,
  resolveGraphSettings
} from "@radius-project/graph-react/presentation";
import {
  graphContextKey,
  normalizeLiveGraph
} from "@radius-project/core/graph";
import type { GraphContext, RadiusGraphData } from "@radius-project/core/graph";
import { parseResourceId } from "@radius-project/core/domain";
import type { ResourceId } from "@radius-project/core/domain";

const context: GraphContext = {
  connectionId: "packed-consumer",
  plane: { type: "radius", name: "local" },
  applicationId:
    "/planes/radius/local/resourceGroups/demo/providers/Applications.Core/applications/demo"
};
const graph: RadiusGraphData = normalizeLiveGraph({ resources: [] }, context);
const identity: ResourceId | undefined = parseResourceId(context.applicationId);
const props: RadiusGraphProps = { graph };
const element = createElement(RadiusGraph, props);
const style: GraphStyle = {
  height: 320,
  fontFamily: "monospace",
  "--radius-graph-node-background": "var(--host-surface)",
  "--radius-graph-host-extension": "8px"
};
const custom = createElement(RadiusGraph, {
  graph,
  appearance: "custom",
  className: "host-graph",
  style
});
const themed = createElement(RadiusGraph, { graph, appearance: "default" });
const built = buildGraph(resolveGraphSettings(), []);
void [
  identity,
  element,
  custom,
  themed,
  built,
  graphContextKey(context),
  mountRadiusGraph
];

// The narrow npm package must not expose the internal Node-facing root.
// @ts-expect-error Internal core APIs are intentionally not public exports.
import "@radius-project/core/modeling";

const invalid: RadiusGraphProps = {
  // @ts-expect-error Renderer inputs must satisfy the public discriminated contract.
  graph: { kind: "not-a-graph", resources: [] }
};
void invalid;

const invalidAppearance: RadiusGraphProps = {
  graph,
  // @ts-expect-error Appearance is a closed choice, not an arbitrary skin name.
  appearance: "host"
};
const invalidToken: GraphStyle = {
  // @ts-expect-error Host graph custom properties accept CSS strings only.
  "--radius-graph-node-background": 12
};
const invalidProperty: GraphStyle = {
  // @ts-expect-error GraphStyle retains CSSProperties validation.
  color: 12
};
const invalidNamespace: GraphStyle = {
  // @ts-expect-error Only the public graph custom-property namespace is open.
  "--unrelated-token": "red"
};
void [invalidAppearance, invalidToken, invalidProperty, invalidNamespace];
