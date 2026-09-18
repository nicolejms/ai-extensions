import { describe, expect, it } from "vitest";
import { parseGraphToolOutput } from "./graph-output.js";

describe("parseGraphToolOutput", () => {
  it("accepts ready graph output", () => {
    const output = parseGraphToolOutput({
      status: "ready",
      definitionFile: ".radius/app.bicep",
      graph: {
        kind: "modeled",
        resources: [
          { id: "web", name: "web", type: "Radius.Compute/containers" }
        ]
      }
    });

    expect(output?.status).toBe("ready");
  });

  it("accepts explicit error output", () => {
    expect(
      parseGraphToolOutput({
        status: "error",
        message: "No application definition was found."
      })
    ).toEqual({
      status: "error",
      message: "No application definition was found."
    });
  });

  it("rejects malformed output", () => {
    expect(parseGraphToolOutput({ status: "ready", graph: {} })).toBeNull();
  });
});
