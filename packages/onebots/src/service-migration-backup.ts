import path from "node:path";
import { parseManagerServiceSpec } from "./manager-service-spec.js";
import { parseRetainedLegacyRuntime } from "./service-migration-retained-runtime.js";
import type { ServiceMigrationBackup } from "./service-migration-types.js";

const HASH = /^[a-f0-9]{64}$/;
const LIMIT = 8 * 1024 * 1024;
const invalid = () => new Error("服务迁移私有备份无效");

export function parseServiceMigrationBackup(input: unknown): ServiceMigrationBackup {
    const value = object(input, [
        "schemaVersion",
        "target",
        "previousRunning",
        "previousEnabled",
        "files",
        ...(input && typeof input === "object" && Object.hasOwn(input, "retainedRuntime")
            ? ["retainedRuntime"]
            : []),
        ...(input && typeof input === "object" && Object.hasOwn(input, "targetCandidateDigest")
            ? ["targetCandidateDigest"]
            : []),
    ]);
    if (
        value.schemaVersion !== 1 ||
        typeof value.previousRunning !== "boolean" ||
        typeof value.previousEnabled !== "boolean" ||
        !Array.isArray(value.files) ||
        Reflect.ownKeys(value.files).length !== value.files.length + 1 ||
        value.files.length < 3 ||
        value.files.length > 4
    )
        throw invalid();
    const target = parseManagerServiceSpec(value.target);
    if (
        Object.hasOwn(value, "targetCandidateDigest") &&
        (typeof value.targetCandidateDigest !== "string" ||
            !HASH.test(value.targetCandidateDigest) ||
            !Object.hasOwn(value, "retainedRuntime"))
    )
        throw invalid();
    const roles = new Set<string>();
    const paths = new Set<string>();
    const files = Array.from({ length: value.files.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value.files, String(index));
        if (!descriptor || !("value" in descriptor)) throw invalid();
        const file = object(descriptor.value, ["role", "path", "mode", "contentBase64"]);
        if (
            typeof file.role !== "string" ||
            !["definition", "metadata", "configuration", "runner"].includes(file.role) ||
            roles.has(file.role) ||
            typeof file.path !== "string" ||
            file.path.length > 4096 ||
            !path.isAbsolute(file.path) ||
            /[\u0000\r\n]/.test(file.path) ||
            paths.has(path.resolve(file.path)) ||
            typeof file.mode !== "number" ||
            !Number.isInteger(file.mode) ||
            file.mode < 0 ||
            file.mode > 0o777 ||
            typeof file.contentBase64 !== "string" ||
            file.contentBase64.length > 2 * 1024 * 1024 ||
            Buffer.from(file.contentBase64, "base64").toString("base64") !== file.contentBase64
        )
            throw invalid();
        roles.add(file.role);
        paths.add(path.resolve(file.path));
        return file as unknown as ServiceMigrationBackup["files"][number];
    });
    if (!["definition", "metadata", "configuration"].every(role => roles.has(role)))
        throw invalid();
    const backup = {
        schemaVersion: 1 as const,
        target,
        previousRunning: value.previousRunning,
        previousEnabled: value.previousEnabled,
        files,
        ...(Object.hasOwn(value, "retainedRuntime")
            ? { retainedRuntime: parseRetainedLegacyRuntime(value.retainedRuntime) }
            : {}),
        ...(typeof value.targetCandidateDigest === "string"
            ? { targetCandidateDigest: value.targetCandidateDigest }
            : {}),
    };
    if (Buffer.byteLength(canonical(backup)) > LIMIT) throw invalid();
    return backup;
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
        throw invalid();
    const own = Reflect.ownKeys(value);
    if (
        own.length !== keys.length ||
        own.some(key => typeof key !== "string" || !keys.includes(key))
    )
        throw invalid();
    const output: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) throw invalid();
        output[key] = descriptor.value;
    }
    return output;
}
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
            )
            .join(",")}}`;
    return JSON.stringify(value);
}
