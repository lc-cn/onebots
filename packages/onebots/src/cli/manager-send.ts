import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
    ControlSendContext,
    ControlSendRequest,
    ControlSendOperation,
} from "@onebots/core/control";
import { createLocalControlClient } from "../client/local-control.js";
import { isControlSendContext, isControlSendOperation } from "@onebots/core/control";
export interface ManagerSendClient {
    sendContext(): Promise<ControlSendContext>;
    sendMessage(request: ControlSendRequest): Promise<ControlSendOperation>;
    sendOperation(id: string): Promise<ControlSendOperation>;
}
interface SendOptions {
    workspace: string;
    account?: string;
    targetType?: ControlSendRequest["targetType"];
    targetId?: string | number;
    message?: string;
    operationId?: string;
    json: boolean;
    query: boolean;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const migration =
    "发送参数无效；请使用 --data-dir、--account、--target-type；旧 --config/-r/-p/--url/--channel 已停用，未发送。";
export const SEND_HELP =
    "onebots send --data-dir 工作区 --account 平台/账号 --target-type private|group|channel [--target-id-type string|number] [--operation-id UUID] [--json] TARGET MESSAGE\nonebots send --data-dir 工作区 --operation-id UUID [--json]\n仅连接现有管理服务；默认保留字符串 ID，结果未知时查询原操作，不重发。";
export function parseManagerSendOptions(args: string[]): SendOptions | null {
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) return null;
    const flags = new Map<string, string>();
    const positional: string[] = [];
    let json = false,
        literals = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (!literals && arg === "--") {
            literals = true;
            continue;
        }
        if (!literals && arg === "--json") {
            if (json) throw new Error(migration);
            json = true;
            continue;
        }
        if (!literals && arg.startsWith("-")) {
            if (
                ![
                    "--data-dir",
                    "--account",
                    "--target-type",
                    "--target-id-type",
                    "--operation-id",
                ].includes(arg) ||
                flags.has(arg)
            )
                throw new Error(migration);
            const value = args[++index];
            if (!value || value.startsWith("-") || /[\u0000-\u001f\u007f]/.test(value))
                throw new Error(migration);
            flags.set(arg, value);
        } else positional.push(arg);
    }
    const operationId = flags.get("--operation-id")?.toLowerCase();
    if (operationId !== undefined && !UUID.test(operationId)) throw new Error(migration);
    const workspace = path.resolve(
        flags.get("--data-dir") ?? process.env.ONEBOTS_WORKSPACE ?? process.cwd(),
    );
    if (/[\u0000-\u001f\u007f]/.test(workspace)) throw new Error(migration);
    if (positional.length === 0 && operationId) {
        if (["--account", "--target-type", "--target-id-type"].some(key => flags.has(key)))
            throw new Error(migration);
        return { workspace, operationId, json, query: true };
    }
    const account = flags.get("--account"),
        targetType = flags.get("--target-type"),
        idType = flags.get("--target-id-type") ?? "string";
    if (
        positional.length !== 2 ||
        !account ||
        account.length > 1024 ||
        account.indexOf("/") < 1 ||
        account.endsWith("/") ||
        !["private", "group", "channel"].includes(targetType ?? "") ||
        !["string", "number"].includes(idType)
    )
        throw new Error(migration);
    const [target, message] = positional;
    if (
        !target ||
        target.length > 4096 ||
        /[\u0000-\u001f\u007f]/.test(target) ||
        !message ||
        Buffer.byteLength(message) > 32768
    )
        throw new Error(migration);
    let targetId: string | number = target;
    if (idType === "number") {
        if (!/^\d+$/.test(target) || !Number.isSafeInteger(Number(target)))
            throw new Error(migration);
        targetId = Number(target);
    }
    return {
        workspace,
        operationId,
        account,
        targetType: targetType as ControlSendRequest["targetType"],
        targetId,
        message,
        json,
        query: false,
    };
}
export interface ManagerSendDependencies {
    client?(workspace: string): ManagerSendClient;
    stdout?(text: string): void;
    stderr?(text: string): void;
    uuid?(): string;
}
/** 单次发送不重试；异常只公开原操作 ID，绝不回显消息正文和上游异常。 */
export async function runManagerSend(
    args: string[],
    dependencies: ManagerSendDependencies = {},
): Promise<number> {
    const stdout = dependencies.stdout ?? (text => process.stdout.write(text));
    const stderr = dependencies.stderr ?? (text => process.stderr.write(text));
    let options: SendOptions | null;
    try {
        options = parseManagerSendOptions(args);
    } catch {
        if (args.includes("--json"))
            stdout(JSON.stringify({ status: "rejected", message: migration }) + "\n");
        else stderr(migration + "\n");
        return 1;
    }
    if (!options) {
        stdout(SEND_HELP + "\n");
        return 0;
    }
    const id = options.operationId ?? (dependencies.uuid ?? randomUUID)();
    stderr(
        `发送操作 ID：${id}；结果未知时使用 send --operation-id ${id} 查询同一工作区，不要重新发送。\n`,
    );
    let status: ControlSendOperation["status"] = "unknown";
    let submitted = false;
    let messageId: string | null | undefined;
    try {
        const client = (dependencies.client ?? createLocalControlClient)(options.workspace);
        const expected = options.query ? undefined : await client.sendContext();
        if (!options.query && !isControlSendContext(expected)) throw new Error();
        let result: ControlSendOperation;
        if (options.query) result = await client.sendOperation(id);
        else {
            submitted = true;
            result = await client.sendMessage({
                id,
                expected: expected!,
                account: options.account!,
                targetType: options.targetType!,
                targetId: options.targetId!,
                message: options.message!,
            });
        }
        if (
            isControlSendOperation(result) &&
            result.id === id &&
            (!expected ||
                (result.gatewayInstanceId === expected.gatewayInstanceId &&
                    result.configVersion === expected.configVersion))
        ) {
            status = result.status;
            if (status === "succeeded") messageId = result.messageId;
        }
    } catch {
        if (!options.query && !submitted) status = "rejected";
        /* 未知结果必须通过同 ID 查询；不重新获取上下文或重发。 */
    }
    const message =
        status === "succeeded"
            ? "发送已确认成功。"
            : status === "rejected"
              ? "发送已拒绝，未确认成功。"
              : "发送结果未确认，可能已经发出；请查询原操作，禁止自动重发。";
    if (options.json)
        stdout(JSON.stringify({ operationId: id, status, message, messageId }) + "\n");
    else if (status === "succeeded") stdout(`操作 ${id}：${message}\n`);
    if (status !== "succeeded") stderr(`操作 ${id}：${message}\n`);
    return status === "succeeded" ? 0 : 1;
}
