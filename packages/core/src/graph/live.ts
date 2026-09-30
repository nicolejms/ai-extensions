import { parseResourceId } from "../domain/resource-id.js";
import type {
  GraphContext,
  LiveGraph,
  LiveGraphResource
} from "./contracts.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Live graph ${field} must be a non-empty string.`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`Live graph ${field} must be a string.`);
  }
  return value;
}

// UCP resource IDs, including plane segments, are case-insensitive.
function sameUcpSegment(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isRadiusType(type: string): boolean {
  return type.toLowerCase().startsWith("radius.");
}

/** Identity for host-owned caches; same-named applications never share context. */
export function graphContextKey(context: GraphContext): string {
  const application = parseResourceId(
    text(context.applicationId, "applicationId")
  );
  if (
    !application ||
    application.segments.length !== 1 ||
    application.type.toLowerCase() !== "radius.core/applications" ||
    !sameUcpSegment(application.plane.type, context.plane.type) ||
    !sameUcpSegment(application.plane.name, context.plane.name)
  ) {
    throw new TypeError(
      "Live graph applicationId must be a Radius.Core/applications resource on the selected plane."
    );
  }
  return JSON.stringify([
    text(context.connectionId, "connectionId"),
    context.plane.type,
    context.plane.name,
    application.id
  ]);
}

/**
 * Normalize UCP connections to source -> target renderer edges. An `Outbound`
 * connection names its destination, so `Outbound` on A to B and `Inbound` on B
 * from A both become the edge A -> B, matching the modeled graph path.
 * Direction is read from the payload alone: no resource type is special-cased,
 * so only the `Radius.*` types the control plane serves are supported. No
 * modeled hashes, Canvas visualization filter, or workflow status projection.
 */
export function normalizeLiveGraph(
  value: unknown,
  context: GraphContext
): LiveGraph {
  graphContextKey(context);
  if (!record(value) || !Array.isArray(value.resources)) {
    throw new TypeError("Live graph resources must be an array.");
  }
  const resources: LiveGraphResource[] = [];
  const connections = new Map<string, unknown[]>();
  const ids = new Set<string>();
  const signatures = new Map<string, string>();
  const warnings: string[] = [];
  for (const raw of value.resources) {
    if (!record(raw))
      throw new TypeError("Live graph resource must be an object.");
    const id = text(raw.id, "resource id");
    const identity = parseResourceId(id);
    if (!identity) throw new TypeError(`Invalid live graph resource id: ${id}`);
    if (raw.connections !== undefined && !Array.isArray(raw.connections)) {
      throw new TypeError(`Live graph connections must be an array: ${id}`);
    }
    const resource: LiveGraphResource = {
      id,
      name: text(raw.name, "resource name"),
      type: text(raw.type, "resource type"),
      provider: optionalText(raw.provider, "provider"),
      provisioningState: optionalText(
        raw.provisioningState,
        "provisioningState"
      ),
      connections: []
    };
    // Only Radius.* types are supported. Check the declared type, not the ID's
    // provider: a nested resource ID can name a different provider.
    if (!isRadiusType(resource.type)) {
      throw new TypeError(
        `Unsupported live graph resource type ${resource.type}: ${id}`
      );
    }
    const entries = Array.isArray(raw.connections) ? raw.connections : [];
    const signature = JSON.stringify([
      resource,
      entries.map((entry: unknown) =>
        record(entry) ? [entry.id, entry.direction] : entry
      )
    ]);
    if (ids.has(id)) {
      if (signatures.get(id) !== signature) {
        throw new TypeError(`Conflicting live graph resource records: ${id}`);
      }
      warnings.push(`Duplicate resource ignored: ${id}`);
      continue;
    }
    ids.add(id);
    signatures.set(id, signature);
    resources.push(resource);
    connections.set(id, entries);
  }
  const edges = new Map<string, { source: string; target: string }>();
  for (const [owner, entries] of connections) {
    for (const entry of entries) {
      if (!record(entry) || typeof entry.id !== "string") {
        warnings.push(`Invalid connection ignored on ${owner}`);
        continue;
      }
      if (entry.direction !== "Inbound" && entry.direction !== "Outbound") {
        throw new TypeError(
          `Invalid live graph connection direction on ${owner}`
        );
      }
      if (
        !parseResourceId(entry.id) ||
        !ids.has(entry.id) ||
        entry.id === owner
      ) {
        warnings.push(
          `Unresolved or self connection ignored: ${owner} -> ${entry.id}`
        );
        continue;
      }
      const inbound = entry.direction === "Inbound";
      const source = inbound ? entry.id : owner;
      const target = inbound ? owner : entry.id;
      edges.set(JSON.stringify([source, target]), { source, target });
    }
  }
  const targetsBySource = new Map<string, string[]>();
  for (const { source, target } of edges.values()) {
    const targets = targetsBySource.get(source);
    if (targets) targets.push(target);
    else targetsBySource.set(source, [target]);
  }
  return {
    kind: "live",
    context: { ...context, plane: { ...context.plane } },
    resources: resources.map((resource) => ({
      ...resource,
      connections: (targetsBySource.get(resource.id) ?? []).map((target) => ({
        id: target,
        direction: "Outbound"
      }))
    })),
    warnings
  };
}
