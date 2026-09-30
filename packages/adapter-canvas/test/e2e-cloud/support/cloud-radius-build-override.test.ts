import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  fetchRadiusBuildManifest,
  installCloudRadiusBuildOverride,
  patchSetupAction,
  renderSetupAction
} from "./cloud-radius-build-override.js";
import type {
  CloudCommandPort,
  CloudCommandResult
} from "./cloud-command-port.js";

const manifest = {
  release: {
    tag: "build-main-b140370-de-50fca9d",
    targetCommit: "b140370356427f77a8cfe1f7aec412fddb96640f",
    assets: {
      cli: "rad-linux-amd64",
      helmChart: "radius-0.42.42-dev.b140370.tgz",
      checksums: "SHA256SUMS"
    }
  },
  images: {
    "applications-rp":
      "ghcr.io/radius-project/applications-rp@sha256:646e465a38faf42e0cd124b6628dd912ac2840dfe43c50adc144bbd07c8b31b9",
    bicep:
      "ghcr.io/radius-project/bicep@sha256:c4973451a8c64fe7ab585262d303d13e40f8d54bae252f97db1473161c237c11",
    controller:
      "ghcr.io/radius-project/controller@sha256:d1303ce916e70bdce14f892d267b7d797f1a197456d0d095165df43bd39d9fa4",
    "dynamic-rp":
      "ghcr.io/radius-project/dynamic-rp@sha256:a7b3f67e5bd4fb111006fb611b30a3856fa57cfe8dd5b513c313bececdded987",
    "pre-upgrade":
      "ghcr.io/radius-project/pre-upgrade@sha256:7223f25d4a98c1eb10e7d4f084f67b37446563cee6e2fa4df8ab721d3702dcb0",
    ucpd: "ghcr.io/radius-project/ucpd@sha256:f64333ffff11f6bba76dd1deffa9821126fc6607ac1a9f6e977a17f11bc21010",
    "deployment-engine":
      "ghcr.io/radius-project/deployment-engine@sha256:50fca9d35f927742ead31c0ca175faae8e88ab46a8d789da0885a616549961f7"
  }
};
const manifestUrl =
  "https://github.com/radius-project/radius/releases/download/build-main-b140370-de-50fca9d/publication-manifest.json";

describe("fetchRadiusBuildManifest", () => {
  it("accepts an immutable Radius build release manifest", async () => {
    await expect(
      fetchRadiusBuildManifest(
        manifestUrl,
        async () => new Response(JSON.stringify(manifest))
      )
    ).resolves.toEqual(manifest);
  });

  it("rejects an untrusted manifest URL before fetching it", async () => {
    let fetched = false;
    await expect(
      fetchRadiusBuildManifest(
        "https://example.com/manifest.json",
        async () => {
          fetched = true;
          return new Response("{}");
        }
      )
    ).rejects.toThrow(/immutable radius-project\/radius build release asset/);
    expect(fetched).toBe(false);
  });

  it("rejects mutable or malformed artifact identities", async () => {
    const invalid = {
      ...manifest,
      images: {
        ...manifest.images,
        "deployment-engine": "ghcr.io/radius-project/deployment-engine:latest"
      }
    };
    await expect(
      fetchRadiusBuildManifest(
        manifestUrl,
        async () => new Response(JSON.stringify(invalid))
      )
    ).rejects.toThrow(/deployment-engine.*not digest-pinned/);
  });

  it("reports a failed manifest download", async () => {
    await expect(
      fetchRadiusBuildManifest(
        manifestUrl,
        async () => new Response("unavailable", { status: 503 })
      )
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("patchSetupAction", () => {
  it("replaces the generated action reference with the fixture-local override", () => {
    expect(
      patchSetupAction(
        "uses: radius-project/ai-extensions/.github/extension/actions/setup-control-plane@abc123\n"
      )
    ).toBe("uses: ./.github/actions/cloud-e2e-setup-control-plane\n");
  });

  it("refuses an absent or ambiguous setup action reference", () => {
    expect(() => patchSetupAction("steps: []\n")).toThrow(/found 0/);
    expect(() =>
      patchSetupAction(
        "radius-project/ai-extensions/.github/extension/actions/setup-control-plane@a\n" +
          "radius-project/ai-extensions/.github/extension/actions/setup-control-plane@b\n"
      )
    ).toThrow(/found 2/);
  });
});

describe("renderSetupAction", () => {
  it("pins the CLI, chart, Radius images, and Deployment Engine build", () => {
    const action = renderSetupAction(manifest);
    const parsed = parse(action) as {
      runs?: {
        using?: string;
      };
    };

    expect(parsed.runs?.using).toBe("composite");
    expect(action).toContain(manifest.release.targetCommit);
    expect(action).toContain(manifest.release.assets.cli);
    expect(action).toContain(manifest.release.assets.helmChart);
    for (const image of Object.values(manifest.images))
      expect(action).toContain(image);
    expect(action).toContain("sha256sum -c -");
    expect(action).toContain("rad install kubernetes --chart ./radius.tgz");
  });
});

describe("installCloudRadiusBuildOverride", () => {
  it("patches every Azure lifecycle workflow and pushes one fixture commit", async () => {
    const workspace = await fs.mkdtemp(
      path.join(os.tmpdir(), "cloud-radius-build-")
    );
    const workflows = path.join(workspace, ".github", "workflows");
    await fs.mkdir(workflows, { recursive: true });
    const generated =
      "steps:\n" +
      "  - name: Set up control plane\n" +
      "    uses: radius-project/ai-extensions/.github/extension/actions/setup-control-plane@abc123\n";
    for (const name of [
      "run-rad-commands-azure.yml",
      "delete-azure.yml",
      "delete-environment-azure.yml"
    ])
      await fs.writeFile(path.join(workflows, name), generated);

    const calls: string[] = [];
    const success = (): CloudCommandResult => ({
      code: 0,
      stdout: "",
      stderr: ""
    });
    const commands: CloudCommandPort = {
      runAz: () => Promise.resolve(success()),
      runGh: (args) => {
        calls.push(`gh ${args.join(" ")}`);
        return Promise.resolve(success());
      },
      runGhPackage: () => Promise.resolve(success()),
      runGit: (args) => {
        calls.push(`git ${args.join(" ")}`);
        return Promise.resolve(success());
      },
      runKubectl: () => Promise.resolve(success())
    };

    try {
      await installCloudRadiusBuildOverride({
        manifestUrl,
        workspacePath: workspace,
        defaultBranch: "main",
        commands,
        fetch: async () => new Response(JSON.stringify(manifest))
      });

      for (const name of [
        "run-rad-commands-azure.yml",
        "delete-azure.yml",
        "delete-environment-azure.yml"
      ])
        await expect(
          fs.readFile(path.join(workflows, name), "utf8")
        ).resolves.toContain(
          "uses: ./.github/actions/cloud-e2e-setup-control-plane"
        );
      await expect(
        fs.readFile(
          path.join(
            workspace,
            ".github",
            "actions",
            "cloud-e2e-setup-control-plane",
            "action.yml"
          ),
          "utf8"
        )
      ).resolves.toContain(manifest.images["deployment-engine"]);
      expect(calls).toEqual([
        "git fetch origin main",
        "git reset --hard origin/main",
        "gh auth setup-git",
        "git config user.name radius-cloud-e2e",
        "git config user.email radius-cloud-e2e@users.noreply.github.com",
        "git add .github",
        "git commit -m test: use Radius build b140370356",
        "git push origin HEAD:main"
      ]);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
