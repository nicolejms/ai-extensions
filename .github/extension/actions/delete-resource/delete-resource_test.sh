#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
readonly REPO_ROOT

node - "${REPO_ROOT}" <<'NODE'
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

const repoRoot = process.argv[2];
const actionFile = join(
  repoRoot,
  ".github/extension/actions/delete-resource/action.yml"
);
const scratchRoot = mkdtempSync(join(tmpdir(), "delete-resource-test-"));
const artifactPath = spawnSync(
  "bash",
  [
    "-lc",
    "if command -v cygpath >/dev/null 2>&1; then cygpath -w /tmp/radius-output/rad-delete-result.json; else printf '%s' /tmp/radius-output/rad-delete-result.json; fi"
  ],
  { encoding: "utf8" }
).stdout.trim();
const failures = [];

function fail(message) {
  failures.push(message);
}

function extractRunBlock() {
  const lines = readFileSync(actionFile, "utf8").split(/\r?\n/u);
  const nameIndex = lines.findIndex((line) =>
    /^\s*-\s*name:\s*Delete Radius resource\s*$/u.test(line)
  );
  if (nameIndex < 0) throw new Error("Delete Radius resource step not found");
  const runIndex = lines.findIndex(
    (line, index) => index > nameIndex && /^\s*run:\s*\|\s*$/u.test(line)
  );
  if (runIndex < 0) throw new Error("Delete Radius resource run block not found");

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

function executable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function runCase(
  name,
  {
    resourceType = "application",
    resourceName = "Demo",
    radExit = "0",
    remaining = "",
    kubectlDeleteExit = "0",
    kubectlGetExit = "0",
    targetKubeconfig = "/tmp/target-kubeconfig",
    namespace = "apps"
  } = {}
) {
  const caseRoot = join(scratchRoot, name);
  const bin = join(caseRoot, "bin");
  mkdirSync(bin, { recursive: true });
  const calls = join(caseRoot, "calls.log");

  executable(
    join(bin, "rad"),
    `#!/usr/bin/env bash
printf 'rad %s\\n' "$*" >> "\${CALLS}"
printf 'synthetic rad output\\n'
exit "\${RAD_EXIT}"
`
  );
  executable(
    join(bin, "kubectl"),
    `#!/usr/bin/env bash
printf 'kubectl %s\\n' "$*" >> "\${CALLS}"
if [[ " $* " == *" delete "* ]]; then
  exit "\${KUBECTL_DELETE_EXIT}"
fi
if [[ " $* " == *" get "* ]]; then
  if [ "\${KUBECTL_GET_EXIT}" != "0" ]; then
    exit "\${KUBECTL_GET_EXIT}"
  fi
  printf '%s' "\${KUBECTL_REMAINING}"
fi
`
  );
  executable(
    join(bin, "jq"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const value = {};
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--arg") {
    value[args[index + 1]] = args[index + 2];
    index += 2;
  } else if (args[index] === "--argjson") {
    value[args[index + 1]] = JSON.parse(args[index + 2]);
    index += 2;
  } else if (args[index] === "--rawfile") {
    value[args[index + 1]] = fs.readFileSync(args[index + 2], "utf8");
    index += 2;
  }
}
process.stdout.write(JSON.stringify({
  schemaVersion: "1.0",
  outcome: value.outcome,
  exitCode: value.exitCode,
  resourceType: value.resourceType,
  name: value.name,
  forced: value.forced,
  output: value.output
}));
`
  );

  const script = join(caseRoot, "run.sh");
  writeFileSync(script, extractRunBlock(), "utf8");
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CALLS: calls,
      RESOURCE_TYPE: resourceType,
      RESOURCE_NAME: resourceName,
      REFRESH_AZURE_OIDC_TOKEN: "false",
      FORCE_DELETE: "false",
      TARGET_KUBECONFIG: targetKubeconfig,
      TARGET_NAMESPACE: namespace,
      RAD_EXIT: radExit,
      KUBECTL_REMAINING: remaining,
      KUBECTL_DELETE_EXIT: kubectlDeleteExit,
      KUBECTL_GET_EXIT: kubectlGetExit
    }
  });
  const callText = existsSync(calls) ? readFileSync(calls, "utf8") : "";
  const artifact = JSON.parse(
    readFileSync(artifactPath, "utf8")
  );
  return { result, calls: callText, artifact };
}

let execution = runCase("application-success");
if (execution.result.status !== 0)
  fail(`application cleanup failed: ${execution.result.stderr}`);
if (!execution.calls.includes("rad app delete Demo --yes --preview"))
  fail("application cleanup did not invoke rad app delete");
const expectedScope =
  "kubectl --kubeconfig /tmp/target-kubeconfig delete " +
  "deployments,statefulsets,daemonsets,services,horizontalpodautoscalers,pods " +
  "--namespace apps --selector radapp.io/application=demo " +
  "--ignore-not-found=true --wait=true --timeout=120s";
if (!execution.calls.includes(expectedScope))
  fail("application cleanup did not delete the exact Radius-labeled resource scope");
if (
  !execution.calls.includes(
    "kubectl --kubeconfig /tmp/target-kubeconfig get "
  )
)
  fail("application cleanup did not verify residual resources are absent");
if (
  execution.artifact.outcome !== "succeeded" ||
  execution.artifact.exitCode !== 0
)
  fail("successful application cleanup wrote a failed result artifact");

execution = runCase("application-default-cluster", {
  targetKubeconfig: "",
  namespace: "default"
});
if (execution.result.status !== 0)
  fail(`default-cluster cleanup failed: ${execution.result.stderr}`);
if (
  !execution.calls.includes(
    "kubectl delete deployments,statefulsets,daemonsets,services,horizontalpodautoscalers,pods " +
      "--namespace default --selector radapp.io/application=demo"
  )
)
  fail("default-cluster cleanup did not omit the empty kubeconfig argument");
if (execution.calls.includes("--kubeconfig"))
  fail("default-cluster cleanup passed an empty kubeconfig argument");

execution = runCase("environment-success", { resourceType: "environment" });
if (execution.result.status !== 0)
  fail(`environment cleanup failed: ${execution.result.stderr}`);
if (!execution.calls.includes("rad env delete Demo --yes --preview"))
  fail("environment cleanup did not invoke rad env delete");
if (execution.calls.includes("kubectl "))
  fail("environment cleanup must not delete application-labeled Kubernetes resources");
if (execution.artifact.outcome !== "succeeded")
  fail("successful environment cleanup wrote a failed result artifact");

execution = runCase("rad-failure", { radExit: "7" });
if (execution.result.status !== 7)
  fail(`rad failure returned ${execution.result.status}, expected 7`);
if (execution.calls.includes("kubectl "))
  fail("Kubernetes cleanup ran after rad delete failed");
if (
  execution.artifact.outcome !== "failed" ||
  execution.artifact.exitCode !== 7
)
  fail("rad failure was not preserved in the result artifact");

execution = runCase("residual-hpa", {
  remaining: "horizontalpodautoscaler.autoscaling/sleeper\n"
});
if (execution.result.status !== 1)
  fail("residual HPA did not fail the delete action");
if (!execution.result.stderr.includes("horizontalpodautoscaler"))
  fail("residual HPA failure did not identify the remaining resource");
if (
  execution.artifact.outcome !== "failed" ||
  execution.artifact.exitCode !== 1
)
  fail("residual HPA failure was not recorded in the result artifact");

execution = runCase("kubectl-failure", { kubectlDeleteExit: "9" });
if (execution.result.status !== 1)
  fail("Kubernetes cleanup failure did not fail the delete action");
if (
  execution.artifact.outcome !== "failed" ||
  execution.artifact.exitCode !== 1
)
  fail("Kubernetes cleanup failure was not recorded in the result artifact");

execution = runCase("kubectl-verification-failure", { kubectlGetExit: "8" });
if (execution.result.status !== 1)
  fail("Kubernetes verification failure did not fail the delete action");
if (
  execution.artifact.outcome !== "failed" ||
  execution.artifact.exitCode !== 1
)
  fail("Kubernetes verification failure was not recorded in the result artifact");

rmSync(scratchRoot, { recursive: true, force: true });
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Delete resource action tests passed");
NODE
