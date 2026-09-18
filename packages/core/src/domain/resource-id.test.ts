import { describe, expect, it } from "vitest";
import { parseResourceId } from "./resource-id.js";

const prefix = "/planes/radius/local/resourceGroups/team/providers/";

describe("UCP resource identity", () => {
  it.each(["Radius.Compute", "Radius.Core", "Radius.Custom2"])(
    "preserves %s identity, punctuation and nested types",
    (provider) => {
      const id = `${prefix}${provider}/applications/app.one_2/children/child`;
      expect(parseResourceId(id)).toEqual({
        id,
        plane: { type: "radius", name: "local" },
        resourceGroup: "team",
        provider,
        type: `${provider}/applications/children`,
        name: "child",
        segments: [
          { type: "applications", name: "app.one_2" },
          { type: "children", name: "child" }
        ]
      });
    }
  );
  it.each([
    "",
    "name",
    "/planes/radius/local",
    `${prefix}Radius.Core/apps`,
    `${prefix}Radius.Core/apps/a/`,
    `${prefix}Radius.Core/apps/..`,
    `${prefix}Radius.Core/apps/a?query`,
    `${prefix}Radius.Core/apps/a#fragment`,
    `${prefix}Radius.Core/apps/a\\b`,
    `${prefix}Radius.Core/apps/a b`,
    "/wrong/radius/local/resourceGroups/team/providers/Radius.Core/apps/a",
    "/planes/radius/local/groups/team/providers/Radius.Core/apps/a",
    "/planes/radius/local/resourceGroups/team/wrong/Radius.Core/apps/a",
    "/planes//local/resourceGroups/team/providers/Radius.Core/apps/a"
  ])("rejects malformed identity %s", (id) => {
    expect(parseResourceId(id)).toBeUndefined();
  });
});
