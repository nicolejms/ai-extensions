import { createElement } from "react";
import { RadiusGraph, mountRadiusGraph } from "@radius-project/graph-react";
import type { RadiusGraphProps } from "@radius-project/graph-react";
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
const built = buildGraph(resolveGraphSettings(), []);
void [identity, element, built, graphContextKey(context), mountRadiusGraph];

// The narrow npm package must not expose the internal Node-facing root.
// @ts-expect-error Internal core APIs are intentionally not public exports.
import "@radius-project/core/modeling";

const invalid: RadiusGraphProps = {
  // @ts-expect-error Renderer inputs must satisfy the public discriminated contract.
  graph: { kind: "not-a-graph", resources: [] }
};
void invalid;
