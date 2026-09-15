import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { repoRoot } from "./plugins.mjs";
import {
  validateBuildBoundary,
  validateLibraryManifest,
  validateStylesheetBoundary
} from "./library-artifacts.mjs";

const require = createRequire(import.meta.url);
const artifacts = join(repoRoot, ".artifacts", "libraries");
mkdirSync(artifacts, { recursive: true });
const runDirectory = mkdtempSync(join(artifacts, "consumer-"));
const graphRoot = join(repoRoot, "packages", "graph-react");
const coreRoot = join(repoRoot, "packages", "core");
const candidates = join(artifacts, "packages");
const dependencyTarballs = join(runDirectory, "dependencies");
const emptyConfig = join(runDirectory, "empty.npmrc");
const emptyGlobalConfig = join(runDirectory, "empty-global.npmrc");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function environment() {
  const env = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATHEXT"
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: runDirectory,
    USERPROFILE: runDirectory,
    TMP: runDirectory,
    TEMP: runDirectory,
    npm_config_userconfig: emptyConfig,
    npm_config_globalconfig: emptyGlobalConfig,
    npm_config_cache: join(runDirectory, "npm-cache"),
    npm_config_offline: "true",
    npm_config_registry: "http://127.0.0.1:9",
    npm_config_ignore_scripts: "true"
  };
}

function run(cli, args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: environment(),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${cli} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`
  );
  return result.stdout;
}

function npmCli() {
  const directories = [
    dirname(process.execPath),
    ...(process.env.PATH ?? process.env.Path ?? "").split(delimiter)
  ];
  for (const directory of directories) {
    for (const relative of [
      ["node_modules", "npm", "bin", "npm-cli.js"],
      ["..", "lib", "node_modules", "npm", "bin", "npm-cli.js"]
    ]) {
      const path = resolve(directory, ...relative);
      if (existsSync(path)) return path;
    }
  }
  throw new Error(
    "The packed consumer smoke requires npm installed alongside Node."
  );
}

function installedPackage(name, from) {
  const resolveFrom = createRequire(join(from, "package.json"));
  let entry;
  try {
    mkdirSync(candidates, { recursive: true });
    mkdirSync(dependencyTarballs, { recursive: true });
    writeFileSync(emptyConfig, "");
    writeFileSync(emptyGlobalConfig, "");
    entry = resolveFrom.resolve(`${name}/package.json`);
  } catch {
    entry = resolveFrom.resolve(name);
  }
  let root = dirname(entry);
  while (
    !existsSync(join(root, "package.json")) ||
    typeof readJson(join(root, "package.json")).name !== "string"
  ) {
    const parent = dirname(root);
    assert.notEqual(parent, root, `Cannot locate installed package ${name}`);
    root = parent;
  }
  root = realpathSync(root);
  return { root, manifest: readJson(join(root, "package.json")) };
}

function dependencyClosure(seeds, overrides) {
  const packages = new Map();
  function visit(installed) {
    const { root, manifest } = installed;
    const previous = packages.get(manifest.name);
    if (previous) {
      assert.equal(
        previous.manifest.version,
        manifest.version,
        `Conflicting fixture dependency ${manifest.name}`
      );
      return;
    }
    packages.set(manifest.name, installed);
    for (const name of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies
    })) {
      if (name === "@radius-project/core") continue;
      if (
        manifest.peerDependenciesMeta?.[name]?.optional &&
        !overrides.has(name)
      )
        continue;
      visit(overrides.get(name) ?? installedPackage(name, root));
    }
  }
  for (const installed of seeds) visit(installed);
  return packages;
}

function tarballName(manifest) {
  return `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`;
}

function assertInstalledLibrary(consumer, directory, tarball, coreVersion) {
  const name = `@radius-project/${directory}`;
  const root = join(consumer, "node_modules", "@radius-project", directory);
  assert.equal(lstatSync(root).isSymbolicLink(), false);
  const manifest = readJson(join(root, "package.json"));
  validateLibraryManifest(manifest, name, coreVersion);
  assert.equal(existsSync(join(root, "src")), false);
  const files = readdirSync(join(root, "dist"), { recursive: true });
  assert.ok(files.some((file) => file.endsWith(".d.ts")));
  assert.equal(
    files.some((file) => /(?<!\.d)\.tsx?$|\.test\.|\.map$/.test(file)),
    false
  );
  assert.equal(
    readFileSync(join(root, "dist", "LICENSE"), "utf8"),
    readFileSync(join(repoRoot, "LICENSE"), "utf8")
  );
  const lock = readJson(join(consumer, "package-lock.json"));
  const installed = lock.packages[`node_modules/${name}`];
  assert.equal(
    installed.integrity,
    `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`
  );
  return root;
}

async function exerciseBrowser(consumer) {
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<!doctype html><html lang="en"><title>Packed Radius graph candidate</title><link rel="stylesheet" href="/browser.css"><div id="root" style="width:850px;height:650px"></div><script type="module" src="/browser.js"></script></html>'
      );
      return;
    }
    const files = {
      "/browser.js": "text/javascript",
      "/browser.css": "text/css"
    };
    if (!Object.hasOwn(files, request.url)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", files[request.url]);
    response.end(
      readFileSync(join(consumer, "browser-dist", request.url.slice(1)))
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await page.goto(`http://127.0.0.1:${address.port}`);
    const web = page.getByRole("group", { name: "web", exact: true });
    const db = page.getByRole("group", { name: "db", exact: true });
    await web.waitFor();
    await db.waitFor();
    await page.waitForFunction(
      () =>
        globalThis.document.querySelectorAll(".react-flow__edge").length === 1
    );
    const boxes = await page.locator(".rad-node").evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          bottom: box.bottom
        };
      })
    );
    assert.equal(boxes.length, 2);
    for (const box of boxes) {
      assert.ok(Object.values(box).every(Number.isFinite));
      assert.ok(
        box.width > 100 && box.height > 50,
        "Candidate CSS must size real cards"
      );
    }
    assert.ok(
      boxes[0].top >= boxes[1].bottom || boxes[1].top >= boxes[0].bottom
    );
    const details = web.getByRole("button", { name: "Show details" });
    await details.focus();
    await page.keyboard.press("Enter");
    await page.locator("[data-radius-details]").waitFor({ state: "visible" });
    assert.match(
      await page.locator("[data-radius-details]").textContent(),
      /CandidatePending/
    );
    await page.keyboard.press("Escape");
    await page.locator("[data-radius-details]").waitFor({ state: "hidden" });
    assert.equal(
      await details.evaluate(
        (element) => globalThis.document.activeElement === element
      ),
      true
    );
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

try {
  const npm = npmCli();
  const pnpm = process.env.npm_execpath;
  assert.ok(
    pnpm && existsSync(pnpm),
    "Run this smoke with pnpm run test:integration:libraries."
  );
  const coreManifest = readJson(join(coreRoot, "package.json"));
  const graphManifest = readJson(join(graphRoot, "package.json"));
  validateStylesheetBoundary(
    readJson(join(artifacts, "graph-react-css-build.json"))
  );
  for (const [directory, root] of [
    ["core", coreRoot],
    ["graph-react", graphRoot]
  ]) {
    validateBuildBoundary(
      readJson(join(artifacts, `${directory}-build.json`)),
      directory
    );
    run(pnpm, ["pack", "--pack-destination", candidates], root);
  }
  const coreTarball = join(candidates, tarballName(coreManifest));
  const graphTarball = join(candidates, tarballName(graphManifest));
  assert.ok(existsSync(coreTarball));
  assert.ok(existsSync(graphTarball));
  const packedDependencies = new Map();
  for (const major of [18, 19]) {
    const consumer = join(runDirectory, `react-${major}`);
    mkdirSync(consumer);
    const override = (name, alias) =>
      installedPackage(
        major === 18 ? alias : name,
        major === 18 ? repoRoot : graphRoot
      );
    const overrides = new Map([
      ["react", override("react", "react18")],
      ["react-dom", override("react-dom", "react-dom18")],
      ["@types/react", override("@types/react", "@types/react18")],
      ["@types/react-dom", override("@types/react-dom", "@types/react-dom18")]
    ]);
    const dependencies = dependencyClosure(
      [
        ...Object.keys(graphManifest.dependencies)
          .filter((name) => name !== coreManifest.name)
          .map((name) => installedPackage(name, graphRoot)),
        ...overrides.values()
      ],
      overrides
    );
    const consumerDependencies = {
      [coreManifest.name]: pathToFileURL(coreTarball).href,
      [graphManifest.name]: pathToFileURL(graphTarball).href
    };
    for (const { root, manifest } of dependencies.values()) {
      const key = `${manifest.name}@${manifest.version}`;
      if (!packedDependencies.has(key)) {
        run(pnpm, ["pack", "--pack-destination", dependencyTarballs], root);
        packedDependencies.set(
          key,
          join(dependencyTarballs, tarballName(manifest))
        );
      }
      consumerDependencies[manifest.name] = pathToFileURL(
        packedDependencies.get(key)
      ).href;
    }
    writeJson(join(consumer, "package.json"), {
      name: `radius-packed-consumer-react-${major}`,
      private: true,
      type: "module",
      dependencies: consumerDependencies
    });
    // Every candidate and dependency comes from local tarballs. Offline mode,
    // an empty config and an unreachable registry forbid a fallback download.
    run(
      npm,
      ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
      consumer
    );
    run(npm, ["ls", "--all", "--json"], consumer);
    const installedCore = assertInstalledLibrary(
      consumer,
      "core",
      coreTarball,
      coreManifest.version
    );
    const installedGraph = assertInstalledLibrary(
      consumer,
      "graph-react",
      graphTarball,
      coreManifest.version
    );
    const consumerRequire = createRequire(join(consumer, "package.json"));
    const graphRequire = createRequire(join(installedGraph, "package.json"));
    assert.equal(
      graphRequire.resolve("@radius-project/core/graph"),
      consumerRequire.resolve("@radius-project/core/graph")
    );
    assert.equal(
      graphRequire.resolve("react"),
      consumerRequire.resolve("react")
    );
    assert.equal(
      graphRequire.resolve("react-dom/client"),
      consumerRequire.resolve("react-dom/client")
    );
    assert.equal(
      readFileSync(join(installedCore, "dist", "graph", "index.js"), "utf8"),
      readFileSync(join(coreRoot, "dist", "graph", "index.js"), "utf8")
    );
    assert.equal(
      readFileSync(
        consumerRequire.resolve("@radius-project/graph-react/styles.css"),
        "utf8"
      ),
      readFileSync(join(graphRoot, "dist", "styles.css"), "utf8")
    );
    for (const file of [
      "consumer.ts",
      "runtime.mjs",
      "browser.mjs",
      "resolution.mjs"
    ]) {
      copyFileSync(
        join(repoRoot, "scripts", "fixtures", "libraries", file),
        join(consumer, file)
      );
    }
    run(
      "--import",
      [
        pathToFileURL(join(consumer, "resolution.mjs")).href,
        join(consumer, "runtime.mjs"),
        overrides.get("react").manifest.version
      ],
      consumer
    );
    writeJson(join(consumer, "tsconfig.json"), {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        types: ["react", "react-dom"],
        strict: true,
        skipLibCheck: false,
        noUncheckedSideEffectImports: true,
        noEmit: true
      },
      files: ["consumer.ts"]
    });
    const declarations = run(
      join(dirname(require.resolve("typescript/package.json")), "bin", "tsc"),
      ["-p", "tsconfig.json", "--listFiles"],
      consumer
    );
    const compilerPackage = installedPackage("typescript", repoRoot);
    const compilerLibraries = [join(compilerPackage.root, "lib")];
    const nativeCompiler = `@typescript/typescript-${process.platform}-${process.arch}`;
    if (compilerPackage.manifest.optionalDependencies?.[nativeCompiler]) {
      compilerLibraries.push(
        join(installedPackage(nativeCompiler, compilerPackage.root).root, "lib")
      );
    }
    for (const file of declarations.trim().split(/\r?\n/)) {
      const contained = [consumer, ...compilerLibraries].some((root) => {
        const path = relative(realpathSync(root), realpathSync(file));
        return !path.startsWith("..") && !isAbsolute(path);
      });
      assert.ok(
        contained,
        `Workspace declarations leaked into consumer: ${file}`
      );
    }
    const bundled = await build({
      absWorkingDir: consumer,
      entryPoints: ["browser.mjs"],
      outdir: join(consumer, "browser-dist"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      metafile: true
    });
    for (const input of Object.keys(bundled.metafile.inputs)) {
      assert.ok(
        resolve(consumer, input).startsWith(`${consumer}${sep}`),
        `Workspace resolution leaked into consumer: ${input}`
      );
    }
    const css = readFileSync(
      join(consumer, "browser-dist", "browser.css"),
      "utf8"
    );
    assert.match(css, /\.radius-graph/);
    assert.match(css, /\.react-flow/);
    await exerciseBrowser(consumer);
    writeJson(join(artifacts, `react-${major}-smoke.json`), {
      react: overrides.get("react").manifest.version,
      core: coreManifest.version,
      graphReact: graphManifest.version,
      runtime: "passed",
      declarations: "passed",
      browserBundle: "passed",
      chromiumComponent: "passed",
      css: "passed",
      peers: "passed",
      installedTarballIntegrity: "verified",
      offline: true
    });
    console.log(
      `Packed libraries: React ${major} runtime, declarations, browser bundle, Chromium component, CSS and peers passed.`
    );
  }
} finally {
  rmSync(runDirectory, { recursive: true, force: true });
}
