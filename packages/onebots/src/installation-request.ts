import fs from "node:fs";
import path from "node:path";
import {
    createInstallationPlan,
    type InstallationPlan,
    type InstallationBackend,
} from "./installation.js";
import {
    getRuntimePluginSelection,
    type RuntimePluginSelection,
} from "./runtime-plugin-selection.js";

/** 不含凭据的执行请求；下载、配置阶段都重新按当前宿主目录验证。 */
export function readInstallationRequest(file: string): InstallationPlan {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
        throw new Error("安装请求文件无效");
    const request: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
        !request ||
        typeof request !== "object" ||
        !("schemaVersion" in request) ||
        request.schemaVersion !== 1 ||
        !("selection" in request)
    )
        throw new Error("安装请求格式无效");
    const selection = getRuntimePluginSelection({ plugins: request.selection });
    if (!selection) throw new Error("安装请求缺少扩展选择");
    return createInstallationPlan(selection);
}

export function writeInstallationRequest(
    directory: string,
    selection: RuntimePluginSelection,
): void {
    const plan = createInstallationPlan(selection);
    fs.writeFileSync(
        path.join(directory, "request.json"),
        JSON.stringify({ schemaVersion: 1, selection: plan.selection }) + "\n",
        { mode: 0o600 },
    );
}

export function writeInstallationCredential(directory: string, token: string): void {
    if (token && !/^[a-zA-Z0-9_]+$/.test(token)) throw new Error("Token 格式无效");
    fs.writeFileSync(
        path.join(directory, "npmrc"),
        token
            ? `@icqqjs:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${token}\n`
            : "",
        { mode: 0o600 },
    );
}

export function createDockerRequestBackend(
    directory: string,
    retainedPackages: string[] = [],
    hasExternalAuthentication = false,
): InstallationBackend {
    return {
        deferred: true,
        writeRequest: async plan => writeInstallationRequest(directory, plan.selection),
        retainedPackages,
        credentialHint: "留空仅使用宿主显式提供的认证文件；不会继承全局 npm 配置。",
        install: async (packages, _root, token) => {
            const privatePackage =
                packages.some(spec => spec.startsWith("@onebots/adapter-icqq@")) ||
                retainedPackages.includes("@onebots/adapter-icqq");
            if (privatePackage && !token && !hasExternalAuthentication)
                throw new Error("请填写 ICQQ 包读取 Token，或在宿主提供认证文件后重试");
            writeInstallationCredential(directory, token);
        },
        verify: async () => {
            throw new Error("隔离安装请求不能在表单阶段宣告验证成功");
        },
    };
}
