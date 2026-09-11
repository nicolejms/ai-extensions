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

/** Identity for host-owned caches; same-named applications never share context. */
export function graphContextKey(context: GraphContext): string {
  const application = parseResourceId(
    text(context.applicationId, "applicationId")
  );
  if (
    !application ||
    application.plane.type !== context.plane.type ||
    application.plane.name !== context.plane.name
  ) {
    throw new TypeError(
      "Live graph applicationId must belong to the selected plane."
    );
  }
  return JSON.stringify([
    text(context.connectionId, "connectionId"),
    context.plane.type,
    context.plane.name,
    application.id
  ]);
}

export interface LiveGraphOptions {
  /** Only the legacy UCP payload needs the Applications.Core/gateways workaround. */
  legacyGatewayDirection?: boolean;
}

/**
 * Normalize UCP's dependency direction to source -> target renderer edges.
 * No modeled hashes, Canvas visualization filter, or workflow status projection.
 */
export function normalizeLiveGraph(
  value: unknown,
  context: GraphContext,
  options: LiveGraphOptions = {}
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
      const identity = parseResourceId(entry.id);
      if (!identity || !ids.has(entry.id) || entry.id === owner) {
        warnings.push(
          `Unresolved or self connection ignored: ${owner} -> ${entry.id}`
        );
        continue;
      }
      if (entry.direction !== "Inbound" && entry.direction !== "Outbound") {
        throw new TypeError(
          `Invalid live graph connection direction on ${owner}`
        );
      }
      const legacyGateway =
        options.legacyGatewayDirection === true &&
        entry.direction === "Inbound" &&
        identity.type === "Applications.Core/gateways";
      const inbound = entry.direction === "Inbound" && !legacyGateway;
      const source = inbound ? owner : entry.id;
      const target = inbound ? entry.id : owner;
      edges.set(JSON.stringify([source, target]), { source, target });
    }
  }
  return {
    kind: "live",
    context: { ...context, plane: { ...context.plane } },
    resources: resources.map((resource) => ({
      ...resource,
      connections: [...edges.values()]
        .filter((edge) => edge.source === resource.id)
        .map((edge) => ({
          id: edge.target,
          direction: "Outbound"
        }))
    })),
    warnings
  };
}
