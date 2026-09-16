import assert from "node:assert/strict";

const publicExports = {
  "@radius-project/core": {
    "./graph": "./dist/graph/index",
    "./domain": "./dist/domain/index",
    "./package.json": "./package.json"
  },
  "@radius-project/graph-react": {
    ".": "./dist/index",
    "./presentation": "./dist/presentation",
    "./base.css": "./dist/base.css",
    "./styles.css": "./dist/styles.css",
    "./package.json": "./package.json"
  }
};

export function validateLibraryManifest(manifest, name, coreVersion) {
  assert.equal(manifest.name, name);
  assert.notEqual(manifest.private, true, `${name} must be publishable`);
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.type, "module");
  assert.doesNotMatch(JSON.stringify(manifest), /(?:workspace|catalog):/);
  const expected = publicExports[name];
  assert.ok(expected, `Unknown library: ${name}`);
  assert.deepEqual(
    Object.keys(manifest.exports).sort(),
    Object.keys(expected).sort()
  );
  for (const [subpath, target] of Object.entries(expected)) {
    if (subpath.endsWith(".css") || subpath === "./package.json") {
      assert.equal(manifest.exports[subpath], target);
    } else {
      assert.deepEqual(manifest.exports[subpath], {
        types: `${target}.d.ts`,
        import: `${target}.js`,
        default: `${target}.js`
      });
    }
  }
  if (name === "@radius-project/graph-react") {
    assert.equal(manifest.dependencies["@radius-project/core"], coreVersion);
    assert.equal(manifest.dependencies.dagre, "0.8.5");
    assert.equal(manifest.dependencies.reactflow, "11.11.4");
    assert.equal(manifest.dependencies.react, undefined);
    assert.equal(manifest.dependencies["react-dom"], undefined);
    assert.deepEqual(manifest.peerDependencies, {
      react: "^18.3.1 || ^19.2.8",
      "react-dom": "^18.3.1 || ^19.2.8"
    });
    assert.deepEqual(manifest.sideEffects, ["**/*.css"]);
  }
}

export function validateBuildBoundary(metafile, directory) {
  for (const input of Object.keys(metafile.inputs)) {
    assert.match(input.replaceAll("\\", "/"), /^src\//);
    assert.doesNotMatch(input, /node_modules|adapter-|\.test\.|\.browser\./);
  }

  const allowed = new Set(
    directory === "core" ?
      []
    : [
        "react",
        "react-dom/client",
        "reactflow",
        "dagre",
        "@radius-project/core/graph",
        "@radius-project/core/domain"
      ]
  );
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      if (imported.external) {
        assert.ok(
          allowed.has(imported.path),
          `Unexpected external import: ${imported.path}`
        );
      }
    }
  }
}

export function validateStylesheetBoundary(metafile, entry = "styles.css") {
  assert.ok(
    entry === "base.css" || entry === "styles.css",
    `Unknown public stylesheet: ${entry}`
  );
  const allowed = new Set(
    entry === "base.css" ?
      ["src/base.css"]
    : ["src/styles.css", "src/base.css", "src/theme.css"]
  );
  for (const input of Object.keys(metafile.inputs)) {
    const path = input.replaceAll("\\", "/");
    assert.ok(
      allowed.has(path) || path.endsWith("/reactflow/dist/style.css"),
      `Unexpected stylesheet input: ${input}`
    );
  }
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      assert.ok(
        imported.path.startsWith("data:"),
        `Stylesheet must not fetch an external asset: ${imported.path}`
      );
    }
  }
}
