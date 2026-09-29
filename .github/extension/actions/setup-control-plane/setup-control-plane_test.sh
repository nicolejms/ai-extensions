#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly ACTION_FILE="${SCRIPT_DIR}/action.yml"

node - "${ACTION_FILE}" <<'NODE'
const {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const actionFile = process.argv[2];
const scratchRoot = mkdtempSync(join(tmpdir(), "setup-control-plane-test-"));
const failures = [];
const radiusSourceSha = "a".repeat(40);

function fail(message) {
  failures.push(message);
}

function executable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function extractInstallRunBlock() {
  const lines = readFileSync(actionFile, "utf8").split(/\r?\n/u);
  const nameIndex = lines.findIndex((line) =>
    /^\s*-\s*name:\s*Install Radius CLI\s*$/u.test(line)
  );
  if (nameIndex < 0) throw new Error("Install Radius CLI step not found");
  const runIndex = lines.findIndex(
    (line, index) => index > nameIndex && /^\s*run:\s*\|\s*$/u.test(line)
  );
  if (runIndex < 0) throw new Error("Install Radius CLI run block not found");

  const body = [];
  let baseIndent;
  for (const line of lines.slice(runIndex + 1)) {
    if (!line.trim()) {
      body.push("");
      continue;
    }
    const indent = line.length - line.trimStart().length;
    baseIndent ??= indent;
    if (indent < baseIndent) break;
    body.push(line.slice(baseIndent));
  }
  return `${body.join("\n").replace(/\n+$/u, "")}\n`;
}

function runCase(
  name,
  version,
  gitOutput = `${radiusSourceSha}\trefs/tags/v${version}^{}\n`
) {
  const caseRoot = join(scratchRoot, name);
  const bin = join(caseRoot, "bin");
  const calls = join(caseRoot, "calls.log");
  mkdirSync(bin, { recursive: true });

  executable(
    join(bin, "git"),
    `#!/usr/bin/env bash
printf 'git %s\\n' "$*" >> "\${CALLS}"
printf '%b' "\${GIT_OUTPUT}"
`
  );
  executable(
    join(bin, "curl"),
    `#!/usr/bin/env bash
printf 'curl %s\\n' "$*" >> "\${CALLS}"
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    output="$2"
    shift 2
    continue
  fi
  shift
done
cat > "$output" <<'INSTALLER'
#!/usr/bin/env bash
printf 'installer %s\\n' "$*" >> "\${CALLS}"
INSTALLER
`
  );
  executable(
    join(bin, "rad"),
    `#!/usr/bin/env bash
printf 'rad %s\\n' "$*" >> "\${CALLS}"
`
  );

  const script = join(caseRoot, "run.sh");
  writeFileSync(script, extractInstallRunBlock(), "utf8");
  const result = spawnSync("bash", [script], {
    cwd: caseRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CALLS: calls,
      RADIUS_VERSION: version,
      GIT_OUTPUT: gitOutput
    }
  });
  return {
    result,
    calls: existsSync(calls) ? readFileSync(calls, "utf8") : ""
  };
}

let execution = runCase("stable-version", "1.2.3");
if (execution.result.status !== 0) {
  fail(`stable version failed: ${execution.result.stderr}`);
}
if (
  !execution.calls.includes(
    `https://raw.githubusercontent.com/radius-project/radius/${radiusSourceSha}/deploy/install.sh`
  )
) {
  fail("stable version did not fetch its immutable matching installer");
}
if (!execution.calls.includes("refs/tags/v1.2.3")) {
  fail("stable version did not resolve its release tag");
}
if (!execution.calls.includes("installer --version 1.2.3")) {
  fail("stable version was not passed to the installer");
}
if (!execution.calls.includes("rad version")) {
  fail("installed Radius version was not reported");
}

execution = runCase(
  "lightweight-tag",
  "2.0.0",
  `${radiusSourceSha}\trefs/tags/v2.0.0\n`
);
if (execution.result.status !== 0) {
  fail(`lightweight release tag failed: ${execution.result.stderr}`);
}

execution = runCase("missing-tag", "3.0.0", "");
if (execution.result.status !== 1) {
  fail(`missing release tag returned ${execution.result.status}`);
}
if (!execution.result.stdout.includes("Could not resolve Radius v3.0.0")) {
  fail("missing release tag did not report resolution failure");
}
if (execution.calls.includes("curl ")) {
  fail("missing release tag reached curl");
}

for (const version of ["edge", "v1.2.3", "1.2", "1.2.3-rc1", ""]) {
  execution = runCase(`invalid-${version || "empty"}`.replaceAll(".", "-"), version);
  if (execution.result.status !== 1) {
    fail(`invalid version ${JSON.stringify(version)} returned ${execution.result.status}`);
  }
  if (!execution.result.stdout.includes("radius-version must be an exact stable release")) {
    fail(`invalid version ${JSON.stringify(version)} did not report validation failure`);
  }
  if (execution.calls.includes("curl ") || execution.calls.includes("git ")) {
    fail(`invalid version ${JSON.stringify(version)} reached the network`);
  }
}

rmSync(scratchRoot, { recursive: true, force: true });
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Setup control plane action tests passed");
NODE
