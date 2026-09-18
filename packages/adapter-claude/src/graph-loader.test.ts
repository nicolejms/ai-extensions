import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadApplicationGraph } from "./graph-loader.js";
import type { GraphLoaderDependencies } from "./graph-loader.js";

function missing(): NodeJS.ErrnoException {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function createDependencies(options?: {
  files?: Record<string, string>;
  aliases?: Record<string, string>;
  directories?: string[];
  resources?: unknown[];
}): GraphLoaderDependencies & {
  buildGraph: ReturnType<typeof vi.fn>;
} {
  const workspace = path.resolve("workspace");
  const files = new Map(
    Object.entries(options?.files ?? {}).map(([name, content]) => [
      path.resolve(workspace, name),
      content
    ])
  );
  const aliases = new Map(
    Object.entries(options?.aliases ?? {}).map(([name, target]) => [
      path.resolve(workspace, name),
      path.resolve(target)
    ])
  );
  const directories = new Set(
    (options?.directories ?? []).map((name) => path.resolve(workspace, name))
  );
  const buildGraph = vi.fn(async () => options?.resources ?? []);
  return {
    cwd: () => workspace,
    realpath: async (candidate) => {
      const resolved = path.resolve(candidate);
      if (resolved === workspace) return workspace;
      const alias = aliases.get(resolved);
      if (alias) return alias;
      if (files.has(resolved) || directories.has(resolved)) return resolved;
      throw missing();
    },
    stat: async (candidate) => ({
      isFile: () => files.has(path.resolve(candidate))
    }),
    readFile: async (candidate) => {
      const content = files.get(path.resolve(candidate));
      if (content === undefined) throw missing();
      return content;
    },
    buildGraph,
    log: vi.fn()
  };
}

describe("loadApplicationGraph", () => {
  it("prefers .radius/app.bicep and passes its directory to the shared runner", async () => {
    const dependencies = createDependencies({
      files: {
        ".radius/app.bicep": "extension radius",
        "app.bicep": "root model"
      },
      resources: [{ id: "web", name: "web", type: "Radius.Compute/containers" }]
    });

    const output = await loadApplicationGraph({}, dependencies);

    expect(output.definitionFile).toBe(".radius/app.bicep");
    expect(output.graph.resources).toHaveLength(1);
    expect(dependencies.buildGraph).toHaveBeenCalledWith(
      "extension radius",
      ".radius/app.bicep",
      {
        radArtifactsDir: path.resolve("workspace/.radius"),
        log: dependencies.log
      }
    );
  });

  it("falls back to a root app.bicep", async () => {
    const dependencies = createDependencies({
      files: { "app.bicep": "root model" }
    });

    const output = await loadApplicationGraph({}, dependencies);

    expect(output.definitionFile).toBe("app.bicep");
  });

  it("loads an explicit nested workspace-relative definition", async () => {
    const dependencies = createDependencies({
      files: { "services/api/app.bicep": "api model" }
    });

    const output = await loadApplicationGraph(
      { appBicepPath: "services/api/app.bicep" },
      dependencies
    );

    expect(output.definitionFile).toBe("services/api/app.bicep");
  });

  it.each([
    "../outside.bicep",
    "C:\\outside\\app.bicep",
    "\\\\host\\share\\app.bicep"
  ])("rejects unsafe definition path %s", async (appBicepPath) => {
    await expect(
      loadApplicationGraph({ appBicepPath }, createDependencies())
    ).rejects.toThrow(/workspace-relative|escapes/);
  });

  it("rejects a symlink that resolves outside the workspace", async () => {
    await expect(
      loadApplicationGraph(
        { appBicepPath: "linked.bicep" },
        createDependencies({
          aliases: { "linked.bicep": "../outside/app.bicep" }
        })
      )
    ).rejects.toThrow("escapes the current workspace");
  });

  it("reports a missing explicit definition", async () => {
    await expect(
      loadApplicationGraph(
        { appBicepPath: "missing.bicep" },
        createDependencies()
      )
    ).rejects.toThrow("Application definition not found: missing.bicep");
  });

  it("reports when no default definition exists", async () => {
    await expect(
      loadApplicationGraph({}, createDependencies())
    ).rejects.toThrow("No Radius application definition was found");
  });

  it("rejects a definition path that is not a file", async () => {
    await expect(
      loadApplicationGraph(
        { appBicepPath: ".radius" },
        createDependencies({ directories: [".radius"] })
      )
    ).rejects.toThrow("Application definition is not a file");
  });

  it("propagates graph build failures", async () => {
    const dependencies = createDependencies({
      files: { "app.bicep": "broken model" }
    });
    dependencies.buildGraph.mockRejectedValue(new Error("rad compile failed"));

    await expect(loadApplicationGraph({}, dependencies)).rejects.toThrow(
      "rad compile failed"
    );
  });

  it("rejects malformed graph resources from the shared runner", async () => {
    await expect(
      loadApplicationGraph(
        {},
        createDependencies({
          files: { "app.bicep": "model" },
          resources: [{ definitionLine: "not-a-number" }]
        })
      )
    ).rejects.toThrow();
  });
});
