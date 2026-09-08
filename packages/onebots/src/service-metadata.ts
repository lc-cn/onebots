import fs from "node:fs";
import path from "node:path";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceSpec } from "./service-definition.js";

export type ServiceMetadata =
    | { kind: "missing" }
    | { kind: "invalid" }
    | { kind: "legacy"; spec: ServiceSpec }
    | { kind: "control"; spec: ManagerServiceSpec };
const required = [
    "scope",
    "configPath",
    "adapters",
    "protocols",
    "nodePath",
    "binPath",
    "workingDirectory",
];
function invalid(): never {
    throw new Error("旧服务元数据契约无效");
}
function plain(input: unknown): Record<string, unknown> {
    if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    )
        invalid();
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string") invalid();
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid();
        result[key] = descriptor.value;
    }
    return result;
}
function list(input: unknown): string[] {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) invalid();
    // 拒绝稀疏数组、附加属性及getter；不读取不受信的迭代器。
    if (Reflect.ownKeys(input).length !== input.length + 1) invalid();
    const result: string[] = [];
    for (let index = 0; index < input.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (
            !descriptor ||
            !descriptor.enumerable ||
            !("value" in descriptor) ||
            typeof descriptor.value !== "string" ||
            /[\u0000-\u001f\u007f]/.test(descriptor.value)
        )
            invalid();
        result.push(descriptor.value);
    }
    return result;
}
/** 只解析旧持久化契约；不推导插件、展开路径或更改旧运行参数。 */
export function parseLegacyServiceSpec(input: unknown): ServiceSpec {
    const value = plain(input);
    if (
        required.some(key => !Object.hasOwn(value, key)) ||
        Object.keys(value).some(key => ![...required, "applications"].includes(key)) ||
        (value.scope !== "user" && value.scope !== "system")
    )
        invalid();
    for (const key of ["configPath", "nodePath", "binPath", "workingDirectory"])
        if (
            typeof value[key] !== "string" ||
            !path.isAbsolute(value[key]) ||
            /[\u0000-\u001f\u007f]/.test(value[key])
        )
            invalid();
    return {
        scope: value.scope,
        configPath: value.configPath as string,
        nodePath: value.nodePath as string,
        binPath: value.binPath as string,
        workingDirectory: value.workingDirectory as string,
        adapters: list(value.adapters),
        protocols: list(value.protocols),
        ...(Object.hasOwn(value, "applications") ? { applications: list(value.applications) } : {}),
    };
}
function safeFile(stat: fs.Stats): boolean {
    return (
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.nlink === 1 &&
        [0o400, 0o600].includes(stat.mode & 0o7777) &&
        (!process.getuid || stat.uid === process.getuid())
    );
}
/** 不返回文件正文或底层错误；缺失只能来自首次lstat明确ENOENT。 */
export function readServiceMetadata(file: string): ServiceMetadata {
    try {
        if (
            typeof file !== "string" ||
            !path.isAbsolute(file) ||
            /[\u0000-\u001f\u007f]/.test(file)
        )
            return { kind: "invalid" };
        // 最终路径的安全检查不能允许祖先链接把元数据导向另一工作区。
        for (let ancestor = path.dirname(file); ; ancestor = path.dirname(ancestor)) {
            try {
                const stat = fs.lstatSync(ancestor);
                if (!stat.isDirectory() || stat.isSymbolicLink()) return { kind: "invalid" };
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { kind: "invalid" };
            }
            if (path.dirname(ancestor) === ancestor) break;
        }
        let before: fs.Stats;
        try {
            before = fs.lstatSync(file);
        } catch (error) {
            return {
                kind: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "invalid",
            };
        }
        if (!safeFile(before)) return { kind: "invalid" };
        const raw = new ConfigurationFile(file).readRaw();
        const after = fs.lstatSync(file);
        if (
            !safeFile(after) ||
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.mode !== after.mode ||
            before.uid !== after.uid ||
            before.mtimeMs !== after.mtimeMs ||
            before.ctimeMs !== after.ctimeMs
        )
            return { kind: "invalid" };
        const value = plain(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes)),
        );
        if (Object.hasOwn(value, "runtimeKind") || Object.hasOwn(value, "schemaVersion"))
            return { kind: "control", spec: parseManagerServiceSpec(value) };
        return { kind: "legacy", spec: parseLegacyServiceSpec(value) };
    } catch {
        return { kind: "invalid" };
    }
}
