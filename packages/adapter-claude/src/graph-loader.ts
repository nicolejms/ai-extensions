import { promises as fs } from "node:fs";
import path from "node:path";
import { buildGraphViaRad } from "@radius-project/adapter-shared";
import { GraphResourceSchema } from "./graph-output.js";
import type { ReadyGraphOutput } from "./graph-output.js";

const DEFAULT_DEFINITION_FILES = [".radius/app.bicep", "app.bicep"] as const;

interface FileStat {
  isFile(): boolean;
}

export interface GraphLoaderDependencies {
  cwd(): string;
  realpath(candidate: string): Promise<string>;
  stat(candidate: string): Promise<FileStat>;
  readFile(candidate: string): Promise<string>;
  buildGraph(
    content: string,
    definitionFile: string,
    options: {
      radArtifactsDir: string;
      log: (message: string) => void;
    }
  ): Promise<unknown[]>;
  log(message: string): void;
}

export interface GraphLoaderInput {
  appBicepPath?: string;
}

const productionDependencies: GraphLoaderDependencies = {
  cwd: () => process.cwd(),
  realpath: (candidate) => fs.realpath(candidate),
  stat: (candidate) => fs.stat(candidate),
  readFile: (candidate) => fs.readFile(candidate, "utf8"),
  buildGraph: (content, definitionFile, options) =>
    buildGraphViaRad(content, definitionFile, options),
  log: (message) => console.error(`[radius] ${message}`)
};

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isAbsoluteOnAnyPlatform(candidate: string): boolean {
  return (
    path.isAbsolute(candidate) ||
    /^[A-Za-z]:[\\/]/.test(candidate) ||
    /^[\\/]{2}/.test(candidate)
  );
}

function assertInsideWorkspace(workspace: string, candidate: string): void {
  const relative = path.relative(workspace, candidate);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    return;
  }
  throw new Error("Application definition path escapes the current workspace.");
}

async function resolveDefinitionFile(
  requestedPath: string | undefined,
  dependencies: GraphLoaderDependencies
): Promise<{ absolute: string; relative: string }> {
  const workspace = await dependencies.realpath(
    path.resolve(dependencies.cwd())
  );
  const candidates =
    requestedPath === undefined ?
      [...DEFAULT_DEFINITION_FILES]
    : [requestedPath];

  if (requestedPath !== undefined && isAbsoluteOnAnyPlatform(requestedPath)) {
    throw new Error("Application definition path must be workspace-relative.");
  }

  for (const candidate of candidates) {
    const lexicalPath = path.resolve(workspace, candidate);
    assertInsideWorkspace(workspace, lexicalPath);
    try {
      const realPath = await dependencies.realpath(lexicalPath);
      assertInsideWorkspace(workspace, realPath);
      const stat = await dependencies.stat(realPath);
      if (!stat.isFile()) {
        throw new Error(`Application definition is not a file: ${candidate}`);
      }
      return {
        absolute: realPath,
        relative: path.relative(workspace, realPath).replace(/\\/g, "/")
      };
    } catch (error) {
      if (requestedPath === undefined && isNotFound(error)) continue;
      if (isNotFound(error)) {
        throw new Error(`Application definition not found: ${candidate}`, {
          cause: error
        });
      }
      throw error;
    }
  }

  throw new Error(
    "No Radius application definition was found. Expected .radius/app.bicep or app.bicep in the current workspace."
  );
}

export async function loadApplicationGraph(
  input: GraphLoaderInput,
  dependencies: GraphLoaderDependencies = productionDependencies
): Promise<ReadyGraphOutput> {
  const definition = await resolveDefinitionFile(
    input.appBicepPath,
    dependencies
  );
  const content = await dependencies.readFile(definition.absolute);
  const rawResources = await dependencies.buildGraph(
    content,
    definition.relative,
    {
      radArtifactsDir: path.dirname(definition.absolute),
      log: dependencies.log
    }
  );
  const resources = GraphResourceSchema.array().parse(rawResources);
  return {
    status: "ready",
    definitionFile: definition.relative,
    graph: {
      kind: "modeled",
      resources
    }
  };
}
