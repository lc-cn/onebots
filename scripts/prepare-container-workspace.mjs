/** Test-only explicit approval of a fresh isolated workspace; never runs in the image entrypoint. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function registerContainerWorkspace(image, dataMount, authorityMount, execute) {
    const docker =
        execute ??
        ((args, input) =>
            execFileSync("docker", args, {
                input,
                encoding: "utf8",
                timeout: 60_000,
                maxBuffer: 1024 * 1024,
                stdio: ["pipe", "pipe", "pipe"],
            }));
    const common = ["run", "--rm", "-i", "--mount", dataMount, "--mount", authorityMount, image];
    const plan = JSON.parse(
        docker([
            ...common,
            "workspace",
            "plan",
            "--data-dir",
            "/data",
            "--authority-dir",
            "/var/lib/onebots-authority/authority",
        ]),
    );
    assert.equal(plan.kind, "new", "fixture must begin as a fresh workspace");
    const registered = JSON.parse(
        docker(
            [...common, "workspace", "register", "--plan-file", "-", "--confirm", plan.digest],
            JSON.stringify(plan),
        ),
    );
    assert.equal(registered.status, "committed");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    assert.equal(
        process.argv.length,
        5,
        "usage: prepare-container-workspace.mjs IMAGE DATA_VOLUME AUTHORITY_VOLUME",
    );
    registerContainerWorkspace(
        process.argv[2],
        `type=volume,source=${process.argv[3]},target=/data`,
        `type=volume,source=${process.argv[4]},target=/var/lib/onebots-authority`,
    );
}
