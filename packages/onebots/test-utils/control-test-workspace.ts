import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { planWorkspaceRegistration } from "../src/workspace-admission/registration-plan.js";
import { registerWorkspace } from "../src/workspace-admission/registration.js";
import { startControlHost as startHost } from "../src/control/host.js";

const authorities = new Map<string, string>();
const authorityParents: string[] = [];

afterAll(() => {
    for (const directory of authorityParents.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
    authorities.clear();
});

/** 只由测试创建空目录时显式调用；重启路径绝不借本 helper 自动登记。 */
export async function registerControlTestWorkspace(
    workspace: string,
    desired: "running" | "stopped" = "running",
): Promise<string> {
    const root = fs.realpathSync(workspace);
    if (authorities.has(root)) throw new Error("测试工作区已登记，重启必须复用原 authority");
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-test-authority-"));
    authorityParents.push(parent);
    const authorityDirectory = path.join(parent, "authority");
    const plan = await planWorkspaceRegistration(root, authorityDirectory, { desired });
    await registerWorkspace(plan, plan.digest);
    authorities.set(root, authorityDirectory);
    return authorityDirectory;
}

export function controlTestAuthority(workspace: string): string {
    const authority = authorities.get(fs.realpathSync(workspace));
    if (!authority) throw new Error("请在写入业务测试数据前显式登记空工作区");
    return authority;
}

export function startRegisteredControlHost(options: Parameters<typeof startHost>[0]) {
    return startHost({ ...options, authorityDirectory: controlTestAuthority(options.workspace) });
}
