import { describe, expect, it } from "vitest";
import { graphContextKey, normalizeLiveGraph } from "./live.js";
import { applicationGraphToResources } from "./appgraph.js";

const prefix = "/planes/radius/local/resourceGroups/test/providers/";
const id = (type: string, name: string) => prefix + type + "/" + name;
const context = {
  connectionId: "local-dev",
  plane: { type: "radius", name: "local" },
  applicationId: id("Radius.Core/applications", "application")
};
const web = {
  id: id("Radius.Core/containers", "web"),
  name: "web",
  type: "Radius.Core/containers",
  provisioningState: "Updating"
};
const db = {
  id: id("Radius.Data/databases", "db"),
  name: "db",
  type: "Radius.Data/databases"
};

describe("live UCP graph normalization", () => {
  it("accepts no hashes, keeps full identity and raw status, and does not apply Canvas filtering", () => {
    const image = {
      id: id("Radius.Compute/containerImages", "image"),
      name: "image",
      type: "Radius.Compute/containerImages"
    };
    const result = normalizeLiveGraph({ resources: [web, db, image] }, context);
    expect(result.resources.map((r) => r.id)).toEqual([
      web.id,
      db.id,
      image.id
    ]);
    expect(result.resources[0].provisioningState).toBe("Updating");
    expect(result.resources[0]).not.toHaveProperty("deployStatus");
    expect(result.resources[0]).not.toHaveProperty("diffHash");
    expect(() => applicationGraphToResources({ resources: [web] })).toThrow(
      /diffHash/
    );
  });
  it("retains an explicit empty graph instead of disguising malformed data as empty", () => {
    expect(normalizeLiveGraph({ resources: [] }, context)).toEqual({
      kind: "live",
      context,
      resources: [],
      warnings: []
    });
  });
  it.each(["Radius.Compute", "Radius.Networking"])(
    "normalizes %s Outbound as target -> owner without mutating source meaning",
    (namespace) => {
      const resource = {
        ...web,
        type: `${namespace}/containers`,
        id: id(`${namespace}/containers`, "web"),
        connections: [{ id: db.id, direction: "Outbound" }]
      };
      const input = { resources: [resource, db] };
      const original = structuredClone(input);
      const result = normalizeLiveGraph(input, context);
      expect(result.resources[1].connections).toEqual([
        { id: resource.id, direction: "Outbound" }
      ]);
      expect(result.resources[0].connections).toEqual([]);
      expect(input).toEqual(original);
      expect(normalizeLiveGraph(input, context)).toEqual(result);
    }
  );
  it("normalizes Inbound as owner -> target and deduplicates reciprocal edges", () => {
    const result = normalizeLiveGraph(
      {
        resources: [
          { ...web, connections: [{ id: db.id, direction: "Inbound" }] },
          { ...db, connections: [{ id: web.id, direction: "Outbound" }] }
        ]
      },
      context
    );
    expect(result.resources[0].connections).toEqual([
      { id: db.id, direction: "Outbound" }
    ]);
    expect(result.resources[1].connections).toEqual([]);
  });
  it("applies no type-specific direction correction to gateways", () => {
    const gateway = {
      id: id("Radius.Networking/gateways", "gateway"),
      name: "gateway",
      type: "Radius.Networking/gateways"
    };
    const result = normalizeLiveGraph(
      {
        resources: [
          { ...web, connections: [{ id: gateway.id, direction: "Inbound" }] },
          gateway
        ]
      },
      context
    );
    expect(result.resources[0].connections).toEqual([
      { id: gateway.id, direction: "Outbound" }
    ]);
    expect(result.resources[1].connections).toEqual([]);
  });
  it("reports malformed, missing, and GU-06 self-connections without dropping valid resources", () => {
    const result = normalizeLiveGraph(
      {
        resources: [
          {
            ...web,
            connections: [
              null,
              { id: 1 },
              { id: "invalid" },
              { id: db.id },
              { id: web.id }
            ]
          }
        ]
      },
      context
    );
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].connections).toEqual([]);
    expect(result.warnings).toHaveLength(5);
    expect(result.warnings.every((warning) => warning.includes(web.id))).toBe(
      true
    );
  });
  it("deduplicates identical records but rejects conflicting duplicates", () => {
    expect(
      normalizeLiveGraph({ resources: [web, { ...web }] }, context).warnings
    ).toEqual([`Duplicate resource ignored: ${web.id}`]);
    expect(() =>
      normalizeLiveGraph(
        { resources: [web, { ...web, name: "other" }] },
        context
      )
    ).toThrow(/Conflicting/);
  });
  it("isolates repeated graphs and context snapshots", () => {
    const first = normalizeLiveGraph({ resources: [web] }, context);
    normalizeLiveGraph({ resources: [db] }, context);
    expect(normalizeLiveGraph({ resources: [web] }, context)).toEqual(first);
    expect(first.context).not.toBe(context);
    expect(first.context.plane).not.toBe(context.plane);
  });
  it("keeps identical application names in separate connections, groups and planes distinct", () => {
    const keys = [
      context,
      { ...context, connectionId: "other" },
      {
        ...context,
        applicationId: context.applicationId.replace("/test/", "/other/")
      },
      {
        ...context,
        plane: { type: "radius", name: "prod" },
        applicationId: context.applicationId.replace("/local/", "/prod/")
      }
    ].map(graphContextKey);
    expect(new Set(keys).size).toBe(4);
  });
  it.each([
    null,
    [],
    {},
    { resources: null },
    { resources: [null] },
    { resources: [{ ...web, id: "bad" }] },
    { resources: [{ ...web, name: "" }] },
    { resources: [{ ...web, type: 4 }] },
    { resources: [{ ...web, connections: {} }] },
    { resources: [{ ...web, provider: 1 }] },
    { resources: [{ ...web, provisioningState: false }] },
    {
      resources: [
        { ...web, connections: [{ id: db.id, direction: "wrong" }] },
        db
      ]
    }
  ])("fails explicitly for malformed payload %#", (input) => {
    expect(() => normalizeLiveGraph(input, context)).toThrow(TypeError);
  });
  it.each([
    { ...context, applicationId: "" },
    { ...context, applicationId: "bad" },
    { ...context, connectionId: "" },
    { ...context, plane: { type: "other", name: "local" } },
    { ...context, plane: { type: "radius", name: "other" } }
  ])("rejects invalid or mismatched context %#", (input) => {
    expect(() => graphContextKey(input)).toThrow(TypeError);
  });
  it("preserves empty optional upstream strings without manufacturing a status", () => {
    const result = normalizeLiveGraph(
      { resources: [{ ...web, provider: "", provisioningState: "" }] },
      context
    );
    expect(result.resources[0].provisioningState).toBe("");
    expect(result.resources[0].provider).toBe("");
  });
});
