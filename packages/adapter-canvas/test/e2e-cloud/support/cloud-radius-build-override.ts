import { promises as fs } from "node:fs";
import path from "node:path";
import { expectSuccess, type CloudCommandPort } from "./cloud-command-port.js";

const WORKFLOWS = [
  "run-rad-commands-azure.yml",
  "delete-azure.yml",
  "delete-environment-azure.yml"
] as const;
const SETUP_ACTION =
  "radius-project/ai-extensions/.github/extension/actions/setup-control-plane@";
const LOCAL_SETUP_ACTION = "./.github/actions/cloud-e2e-setup-control-plane";
const IMAGE_KEYS = [
  "applications-rp",
  "bicep",
  "controller",
  "dynamic-rp",
  "pre-upgrade",
  "ucpd",
  "deployment-engine"
] as const;

interface RadiusBuildManifest {
  readonly release: {
    readonly tag: string;
    readonly targetCommit: string;
    readonly assets: {
      readonly cli: string;
      readonly helmChart: string;
      readonly checksums: string;
    };
  };
  readonly images: Record<(typeof IMAGE_KEYS)[number], string>;
}

interface InstallOverrideOptions {
  readonly manifestUrl: string;
  readonly workspacePath: string;
  readonly defaultBranch: string;
  readonly commands: CloudCommandPort;
  readonly fetch?: typeof fetch;
  readonly readFile?: typeof fs.readFile;
  readonly writeFile?: typeof fs.writeFile;
  readonly mkdir?: typeof fs.mkdir;
}

export async function installCloudRadiusBuildOverride(
  options: InstallOverrideOptions
): Promise<void> {
  const manifest = await fetchRadiusBuildManifest(
    options.manifestUrl,
    options.fetch
  );
  const readFile = options.readFile ?? fs.readFile;
  const writeFile = options.writeFile ?? fs.writeFile;
  const mkdir = options.mkdir ?? fs.mkdir;
  const runGit = async (args: readonly string[], context: string) =>
    expectSuccess(
      await options.commands.runGit(args, options.workspacePath),
      context
    );

  await runGit(
    ["fetch", "origin", options.defaultBranch],
    `git fetch origin ${options.defaultBranch}`
  );
  await runGit(
    ["reset", "--hard", `origin/${options.defaultBranch}`],
    `git reset --hard origin/${options.defaultBranch}`
  );

  const actionDirectory = path.join(
    options.workspacePath,
    ".github",
    "actions",
    "cloud-e2e-setup-control-plane"
  );
  await mkdir(actionDirectory, { recursive: true });
  await writeFile(
    path.join(actionDirectory, "action.yml"),
    renderSetupAction(manifest),
    "utf8"
  );

  for (const workflow of WORKFLOWS) {
    const workflowPath = path.join(
      options.workspacePath,
      ".github",
      "workflows",
      workflow
    );
    const source = await readFile(workflowPath, "utf8");
    await writeFile(workflowPath, patchSetupAction(source), "utf8");
  }

  expectSuccess(
    await options.commands.runGh(["auth", "setup-git"]),
    "gh auth setup-git"
  );
  await runGit(
    ["config", "user.name", "radius-cloud-e2e"],
    "git config user.name"
  );
  await runGit(
    ["config", "user.email", "radius-cloud-e2e@users.noreply.github.com"],
    "git config user.email"
  );
  await runGit(["add", ".github"], "git add .github");
  await runGit(
    [
      "commit",
      "-m",
      `test: use Radius build ${manifest.release.targetCommit.slice(0, 10)}`
    ],
    "git commit the Cloud E2E Radius build override"
  );
  await runGit(
    ["push", "origin", `HEAD:${options.defaultBranch}`],
    `git push origin HEAD:${options.defaultBranch}`
  );
}

export async function fetchRadiusBuildManifest(
  manifestUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<RadiusBuildManifest> {
  const url = new URL(manifestUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !/^\/radius-project\/radius\/releases\/download\/build-[a-z0-9-]+\/publication-manifest\.json$/.test(
      url.pathname
    )
  )
    throw new Error(
      "The Cloud E2E Radius build manifest must be an immutable radius-project/radius build release asset."
    );

  const response = await fetchImpl(url);
  if (!response.ok)
    throw new Error(
      `Downloading the Cloud E2E Radius build manifest failed with HTTP ${response.status}.`
    );
  return parseRadiusBuildManifest(await response.json(), url);
}

export function patchSetupAction(source: string): string {
  const matches = source.split(SETUP_ACTION).length - 1;
  if (matches !== 1)
    throw new Error(
      `Expected exactly one setup-control-plane action reference, found ${matches}.`
    );
  return source.replace(
    new RegExp(
      `radius-project/ai-extensions/\\.github/extension/actions/setup-control-plane@[^\\s]+`
    ),
    LOCAL_SETUP_ACTION
  );
}

export function renderSetupAction(manifest: RadiusBuildManifest): string {
  const releaseBase =
    `https://github.com/radius-project/radius/releases/download/` +
    manifest.release.tag;
  const image = manifest.images;
  return [
    "# yaml-language-server: $schema=https://www.schemastore.org/github-action.json",
    "---",
    "name: Cloud E2E - Set up exact Radius build",
    "description: Install the immutable Radius build selected by the Cloud E2E dispatch.",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - name: Install k3d",
    "      shell: bash",
    "      env:",
    "        K3D_VERSION: v5.9.0",
    "        K3D_INSTALL_SHA256: 0f6bd9a3ab8ea8625843b21657a6538f117975bb2823b73200dc8b92ccc626de",
    "      run: |",
    '        curl -fsSL "https://raw.githubusercontent.com/k3d-io/k3d/${K3D_VERSION}/install.sh" -o install-k3d.sh',
    '        echo "${K3D_INSTALL_SHA256}  install-k3d.sh" | sha256sum -c -',
    '        TAG="${K3D_VERSION}" bash install-k3d.sh',
    "        rm -f install-k3d.sh",
    "",
    "    - name: Create ephemeral Radius control plane cluster",
    "      shell: bash",
    "      env:",
    "        GITHUB_WORKSPACE_SAFE: ${{ github.workspace }}",
    "      run: |",
    "        k3d cluster create radius-cp \\",
    "          --volume /var/run/docker.sock:/var/run/docker.sock \\",
    '          --volume "${GITHUB_WORKSPACE_SAFE}/:/app/demo" \\',
    '          --k3s-arg "--disable=traefik@server:*" \\',
    "          --wait",
    "        kubectl wait --for=condition=Ready node --all --timeout=120s",
    "",
    "    - name: Install exact Radius CLI and chart",
    "      shell: bash",
    "      run: |",
    "        set -euo pipefail",
    `        readonly RELEASE_BASE="${releaseBase}"`,
    `        readonly CLI_ASSET="${manifest.release.assets.cli}"`,
    `        readonly CHART_ASSET="${manifest.release.assets.helmChart}"`,
    `        readonly CHECKSUMS_ASSET="${manifest.release.assets.checksums}"`,
    '        curl -fsSL "${RELEASE_BASE}/${CLI_ASSET}" -o rad',
    '        curl -fsSL "${RELEASE_BASE}/${CHART_ASSET}" -o radius.tgz',
    '        curl -fsSL "${RELEASE_BASE}/${CHECKSUMS_ASSET}" -o SHA256SUMS',
    '        grep -E "  (${CLI_ASSET}|${CHART_ASSET})$" SHA256SUMS | sha256sum -c -',
    "        chmod +x rad",
    "        sudo install -m 0755 rad /usr/local/bin/rad",
    "        rad bicep download",
    `        rad version | tee rad-version.txt`,
    `        grep -F "${manifest.release.targetCommit}" rad-version.txt`,
    "",
    "    - name: Install Terraform",
    "      uses: hashicorp/setup-terraform@dfe3c3f87815947d99a8997f908cb6525fc44e9e # v4.0.1",
    "      with:",
    "        terraform_wrapper: false",
    "",
    "    - name: Create target-kubeconfig secret",
    "      shell: bash",
    "      run: |",
    '        if [ ! -f "$RADIUS_TARGET_KUBECONFIG" ]; then',
    '          echo "No target kubeconfig; resources will deploy to the control-plane cluster."',
    "          exit 0",
    "        fi",
    "        kubectl create namespace radius-system --dry-run=client -o yaml | kubectl apply -f -",
    "        kubectl create secret generic target-kubeconfig \\",
    "          --namespace radius-system \\",
    '          --from-file=kubeconfig="$RADIUS_TARGET_KUBECONFIG" \\',
    "          --dry-run=client -o yaml | kubectl apply -f -",
    "",
    "    - name: Install exact Radius control plane",
    "      shell: bash",
    "      run: |",
    "        set -euo pipefail",
    "        TARGET_FLAGS=()",
    '        if [ -f "$RADIUS_TARGET_KUBECONFIG" ]; then',
    "          TARGET_FLAGS+=(--set global.targetCluster.enabled=true)",
    "        fi",
    "        rad install kubernetes --chart ./radius.tgz \\",
    "          --set database.enabled=true \\",
    "          --set database.resources.requests.cpu=500m \\",
    "          --set rp.publicEndpointOverride=localhost \\",
    "          --set dynamicrp.buildkit.enabled=true \\",
    `          --set rp.image=${image["applications-rp"]} \\`,
    `          --set dynamicrp.image=${image["dynamic-rp"]} \\`,
    `          --set controller.image=${image.controller} \\`,
    `          --set ucp.image=${image.ucpd} \\`,
    `          --set bicep.image=${image.bicep} \\`,
    `          --set preupgrade.image=${image["pre-upgrade"]} \\`,
    `          --set de.image=${image["deployment-engine"]} \\`,
    '          "${TARGET_FLAGS[@]}"',
    "        kubectl wait --for=condition=Available deployment --all -n radius-system --timeout=300s",
    ""
  ].join("\n");
}

function parseRadiusBuildManifest(
  value: unknown,
  manifestUrl: URL
): RadiusBuildManifest {
  if (!isRecord(value) || !isRecord(value.release) || !isRecord(value.images))
    throw new Error("The Cloud E2E Radius build manifest is malformed.");
  const release = value.release;
  const assets = release.assets;
  if (
    !isRecord(assets) ||
    typeof release.tag !== "string" ||
    !/^build-[a-z0-9-]+$/.test(release.tag) ||
    !manifestUrl.pathname.includes(`/download/${release.tag}/`) ||
    typeof release.targetCommit !== "string" ||
    !/^[a-f0-9]{40}$/.test(release.targetCommit)
  )
    throw new Error("The Cloud E2E Radius build release identity is invalid.");

  const parsedAssets = {
    cli: requireAssetName(assets.cli, "CLI"),
    helmChart: requireAssetName(assets.helmChart, "Helm chart"),
    checksums: requireAssetName(assets.checksums, "checksums")
  };
  const imageRecords = value.images;
  const images = Object.fromEntries(
    IMAGE_KEYS.map((key) => [key, requireImage(imageRecords, key)])
  ) as RadiusBuildManifest["images"];
  return {
    release: {
      tag: release.tag,
      targetCommit: release.targetCommit,
      assets: parsedAssets
    },
    images
  };
}

function requireAssetName(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))
    throw new Error(`The Radius build ${label} asset name is invalid.`);
  return value;
}

function requireImage(
  images: Record<string, unknown>,
  key: (typeof IMAGE_KEYS)[number]
): string {
  const value = images[key];
  if (
    typeof value !== "string" ||
    !new RegExp(
      `^ghcr\\.io/radius-project/[a-z0-9-]+@sha256:[a-f0-9]{64}$`
    ).test(value)
  )
    throw new Error(`The Radius build image "${key}" is not digest-pinned.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
