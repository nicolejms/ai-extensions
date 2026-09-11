import { describe, expect, it } from "vitest";
import {
  validateBuildBoundary,
  validateLibraryManifest,
  validateStylesheetBoundary
} from "../../../../scripts/library-artifacts.mjs";

function manifest() {
  return {
    name: "@radius-project/graph-react",
    version: "0.1.0",
    license: "Apache-2.0",
    type: "module",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js"
      },
      "./presentation": {
        types: "./dist/presentation.d.ts",
        import: "./dist/presentation.js",
        default: "./dist/presentation.js"
      },
      "./styles.css": "./dist/styles.css"
    },
    dependencies: {
      "@radius-project/core": "0.1.0",
      dagre: "0.8.5",
      reactflow: "11.11.4"
    },
    peerDependencies: {
      react: "^18.3.1 || ^19.2.8",
      "react-dom": "^18.3.1 || ^19.2.8"
    },
    sideEffects: ["**/*.css"]
  };
}

describe("packed library contracts", () => {
  it("bundles the package and React Flow styles without remote assets", () => {
    expect(() =>
      validateStylesheetBoundary({
        inputs: {
          "src/styles.css": {},
          "../../node_modules/reactflow/dist/style.css": {}
        },
        outputs: {
          "dist/styles.css": {
            imports: [{ path: "data:image/svg+xml,<svg/>", external: true }]
          }
        }
      })
    ).not.toThrow();
  });

  it("rejects unexpected stylesheet implementations", () => {
    expect(() =>
      validateStylesheetBoundary({
        inputs: { "../other/styles.css": {} },
        outputs: {}
      })
    ).toThrow("Unexpected stylesheet input");
  });

  it("rejects remote imports left in the compiled stylesheet", () => {
    expect(() =>
      validateStylesheetBoundary({
        inputs: { "src/styles.css": {} },
        outputs: {
          "dist/styles.css": {
            imports: [
              { path: "https://example.invalid/styles.css", external: true }
            ]
          }
        }
      })
    ).toThrow("must not fetch an external asset");
  });

  it("accepts compiled, licensed graph exports and exact candidate core dependencies", () => {
    expect(() =>
      validateLibraryManifest(manifest(), manifest().name, "0.1.0")
    ).not.toThrow();
  });

  it("accepts only the browser-safe graph and domain subpaths of core", () => {
    const core = {
      name: "@radius-project/core",
      type: "module",
      license: "Apache-2.0",
      exports: Object.fromEntries(
        ["graph", "domain"].map((subpath) => [
          `./${subpath}`,
          {
            types: `./dist/${subpath}/index.d.ts`,
            import: `./dist/${subpath}/index.js`,
            default: `./dist/${subpath}/index.js`
          }
        ])
      )
    };
    expect(() =>
      validateLibraryManifest(core, core.name, "0.1.0")
    ).not.toThrow();
    core.exports["."] = "./src/index.ts";
    expect(() => validateLibraryManifest(core, core.name, "0.1.0")).toThrow();
  });

  it("rejects unrecognized library manifests", () => {
    const value = { ...manifest(), name: "unrecognized" };
    expect(() => validateLibraryManifest(value, value.name, "0.1.0")).toThrow(
      "Unknown library"
    );
  });

  it.each([
    [
      "workspace dependency",
      (value) => {
        value.dependencies["@radius-project/core"] = "workspace:*";
      }
    ],
    [
      "catalog dependency",
      (value) => {
        value.devDependencies = { vitest: "catalog:" };
      }
    ],
    [
      "wrong core candidate",
      (value) => {
        value.dependencies["@radius-project/core"] = "0.2.0";
      }
    ],
    [
      "source export",
      (value) => {
        value.exports["."].import = "./src/index.ts";
      }
    ],
    [
      "missing declarations",
      (value) => {
        delete value.exports["."].types;
      }
    ],
    [
      "missing stylesheet",
      (value) => {
        delete value.exports["./styles.css"];
      }
    ],
    [
      "unretained stylesheet",
      (value) => {
        value.sideEffects = false;
      }
    ],
    [
      "private package",
      (value) => {
        value.private = true;
      }
    ],
    [
      "bundled React dependency",
      (value) => {
        value.dependencies.react = "19.2.8";
      }
    ],
    [
      "unsupported peer range",
      (value) => {
        value.peerDependencies.react = "^19.2.8";
      }
    ],
    [
      "unlicensed package",
      (value) => {
        delete value.license;
      }
    ]
  ])("rejects %s", (_label, mutate) => {
    const value = manifest();
    mutate(value);
    expect(() => validateLibraryManifest(value, value.name, "0.1.0")).toThrow();
  });

  it("accepts only source-owned build inputs with external peer and runtime dependencies", () => {
    const build = {
      inputs: { "src/index.ts": {} },
      outputs: {
        "dist/index.js": { imports: [{ path: "react", external: true }] }
      }
    };
    expect(() => validateBuildBoundary(build, "graph-react")).not.toThrow();
    expect(() => validateBuildBoundary(build, "core")).toThrow("react");
  });

  it("accepts internal chunks in the dependency-free core bundle", () => {
    expect(() =>
      validateBuildBoundary(
        {
          inputs: { "src/graph/index.ts": {}, "src\\domain\\index.ts": {} },
          outputs: {
            "dist/graph/index.js": {
              imports: [{ path: "dist/chunk.js", external: false }]
            }
          }
        },
        "core"
      )
    ).not.toThrow();
  });

  it.each(["node:fs", "@radius-project/adapter-canvas", "@github/copilot-sdk"])(
    "rejects a browser bundle importing %s",
    (path) => {
      expect(() =>
        validateBuildBoundary(
          {
            inputs: { "src/index.ts": {} },
            outputs: {
              "dist/index.js": { imports: [{ path, external: true }] }
            }
          },
          "graph-react"
        )
      ).toThrow(path);
    }
  );

  it.each([
    "node_modules/react/index.js",
    "../adapter-canvas/src/index.ts",
    "src/index.test.ts"
  ])(
    "rejects bundled implementation outside the public library: %s",
    (input) => {
      expect(() =>
        validateBuildBoundary(
          {
            inputs: { [input]: {} },
            outputs: {}
          },
          "graph-react"
        )
      ).toThrow();
    }
  );
});
