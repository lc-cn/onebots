import path from "node:path";
import { isIP } from "node:net";
import type { ServiceScope } from "./service-definition.js";

/** 系统托管只启动管理服务；业务配置、扩展选择与网关期望状态归工作区所有。 */
interface ManagerServiceSpecBase {
    runtimeKind: "control";
    scope: ServiceScope;
    workspace: string;
    nodePath: string;
    binPath: string;
    workingDirectory: string;
    host: string;
    port: number;
}
/** 历史契约只读保留；不得在解析时补来源或改变既有摘要。 */
export interface ManagerServiceSpecV1 extends ManagerServiceSpecBase {
    schemaVersion: 1;
}
export interface ManagerServiceSpecV2 extends ManagerServiceSpecBase {
    schemaVersion: 2;
    authorityDirectory: string;
}
export type ManagerServiceSpec = ManagerServiceSpecV1 | ManagerServiceSpecV2;
const KEYS = [
    "schemaVersion",
    "runtimeKind",
    "scope",
    "workspace",
    "nodePath",
    "binPath",
    "workingDirectory",
    "host",
    "port",
];
function invalid(): never {
    throw new Error("管理服务契约无效");
}

/** 只接受闭合普通数据，不读取 getter，不推断工作区、端口或旧插件参数。 */
export function parseManagerServiceSpec(input: unknown): ManagerServiceSpec {
    if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    )
        invalid();
    const version = Object.getOwnPropertyDescriptor(input, "schemaVersion");
    const allowed =
        version && "value" in version && version.value === 2
            ? [...KEYS, "authorityDirectory"]
            : KEYS;
    const keys = Reflect.ownKeys(input);
    if (
        keys.length !== allowed.length ||
        keys.some(key => typeof key !== "string" || !allowed.includes(key))
    )
        invalid();
    const value: Record<string, unknown> = {};
    for (const key of allowed) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid();
        value[key] = descriptor.value;
    }
    if (
        ![1, 2].includes(value.schemaVersion as number) ||
        value.runtimeKind !== "control" ||
        (value.scope !== "user" && value.scope !== "system")
    )
        invalid();
    for (const key of [
        "workspace",
        "nodePath",
        "binPath",
        "workingDirectory",
        ...(value.schemaVersion === 2 ? ["authorityDirectory"] : []),
    ]) {
        const item = value[key];
        if (
            typeof item !== "string" ||
            !item ||
            /[\u0000\r\n]/.test(item) ||
            !path.isAbsolute(item)
        )
            invalid();
    }
    if (value.schemaVersion === 2) {
        const comparable = (item: string) =>
            process.platform === "win32" ? path.resolve(item).toLowerCase() : path.resolve(item);
        const workspace = comparable(value.workspace as string);
        const authority = comparable(value.authorityDirectory as string);
        const contains = (parent: string, child: string) => {
            const relative = path.relative(parent, child);
            return (
                relative === "" ||
                (relative !== ".." &&
                    !relative.startsWith(".." + path.sep) &&
                    !path.isAbsolute(relative))
            );
        };
        if (contains(workspace, authority) || contains(authority, workspace))
            throw new Error(
                "卷外身份目录必须与工作区分离，请显式指定 --authority-dir，不能放在工作区内或其祖先",
            );
    }
    // bind host 使用明确IP或DNS主机名，拒绝URL、控制字符及可被解释为选项的输入。
    if (
        typeof value.host !== "string" ||
        value.host.length > 253 ||
        !(
            isIP(value.host) ||
            /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.?$/.test(
                value.host,
            )
        )
    )
        invalid();
    if (
        typeof value.port !== "number" ||
        !Number.isInteger(value.port) ||
        value.port < 1 ||
        value.port > 65535
    )
        invalid();
    return value as unknown as ManagerServiceSpec;
}

/** 与Node可执行文件分开持久化；调用方必须用argv数组启动，不能拼接shell命令。 */
export function buildManagerServiceArgs(input: ManagerServiceSpec): string[] {
    const spec = parseManagerServiceSpec(input);
    return [
        spec.binPath,
        "serve",
        "--data-dir",
        spec.workspace,
        ...(spec.schemaVersion === 2 ? ["--authority-dir", spec.authorityDirectory] : []),
        "--host",
        spec.host,
        "--port",
        String(spec.port),
    ];
}
