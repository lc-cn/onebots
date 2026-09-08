import path from "node:path";
import type { ControlClient } from "@onebots/core/control";
import { createLocalControlClient } from "../client/local-control.js";
import { writeCliOutput } from "../cli-output.js";
import { parseConfigurationDocument } from "../configuration/configuration-document.js";

export const CONFIGURATION_HELP = `onebots control config <命令> [--data-dir 工作区]
  snapshot                       读取脱敏快照
  create                         从当前快照基线创建草稿，不应用
  read --draft UUID               读取脱敏草稿
  edit --draft UUID --stdin       管道JSON：expectedRevision、changes、secrets
  add-account --draft UUID --stdin 管道JSON：expectedRevision、platform、accountId
  remove-account --draft UUID --stdin 管道JSON：expectedRevision、accountKey
  protocol --draft UUID --stdin  管道JSON：expectedRevision、accountKey、protocol、enabled
                                accountKey 为 null 时修改通用协议配置
  validate --draft UUID --revision SHA256
  apply --request 操作ID --receipt UUID
  operation --request 操作ID
秘密与修改值只接受非终端 stdin（最多1MiB），不接受命令行参数。
应用必须显式提供验证收据；重试沿用同一操作ID，不自动重新应用。`;
type Client = Pick<
    ControlClient,
    | "configurationSnapshot"
    | "createConfigurationDraft"
    | "configurationDraft"
    | "editConfigurationDraft"
    | "addConfigurationAccount"
    | "removeConfigurationAccount"
    | "setConfigurationProtocol"
    | "validateConfigurationDraft"
    | "applyConfiguration"
    | "configurationOperation"
>;
export interface ConfigurationCommandDependencies {
    createClient?(workspace: string): Client;
    stdin?: AsyncIterable<Buffer | string> & { isTTY?: boolean };
    output?(message: string): void;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
class UsageError extends Error {
    constructor() {
        super(`配置命令参数无效。\n${CONFIGURATION_HELP}`);
    }
}
function invalid(): never {
    throw new UsageError();
}

export async function runConfigurationCommand(
    args: string[],
    dependencies: ConfigurationCommandDependencies = {},
): Promise<void> {
    const output = dependencies.output ?? writeCliOutput;
    if (!args.length || (args.length === 1 && ["help", "--help", "-h"].includes(args[0]))) {
        output(CONFIGURATION_HELP);
        return;
    }
    const [action, ...rest] = args;
    const allowed: Record<string, string[]> = {
        snapshot: [],
        create: [],
        read: ["--draft"],
        edit: ["--draft", "--stdin"],
        "add-account": ["--draft", "--stdin"],
        "remove-account": ["--draft", "--stdin"],
        protocol: ["--draft", "--stdin"],
        validate: ["--draft", "--revision"],
        apply: ["--request", "--receipt"],
        operation: ["--request"],
    };
    if (!Object.hasOwn(allowed, action)) invalid();
    const options = new Map<string, string>();
    for (let index = 0; index < rest.length; index++) {
        const key = rest[index];
        if (![...allowed[action], "--data-dir"].includes(key) || options.has(key)) invalid();
        if (key === "--stdin") options.set(key, "true");
        else {
            const value = rest[++index];
            if (!value || value.startsWith("--")) invalid();
            options.set(key, value);
        }
    }
    for (const key of allowed[action]) if (!options.has(key)) invalid();
    for (const [key, pattern] of [
        ["--draft", UUID],
        ["--receipt", UUID],
        ["--revision", HASH],
        ["--request", ID],
    ] as const)
        if (options.has(key) && !pattern.test(options.get(key)!)) invalid();
    try {
        const workspace = path.resolve(
            options.get("--data-dir") ?? process.env.ONEBOTS_WORKSPACE ?? process.cwd(),
        );
        const client = (dependencies.createClient ?? createLocalControlClient)(workspace);
        let result: unknown;
        if (action === "snapshot") result = await client.configurationSnapshot();
        else if (action === "create") {
            const snapshot = await client.configurationSnapshot();
            result = await client.createConfigurationDraft(snapshot.base);
        } else if (action === "read")
            result = await client.configurationDraft(options.get("--draft")!);
        else if (["edit", "add-account", "remove-account", "protocol"].includes(action)) {
            const body = await readJson(dependencies.stdin ?? process.stdin);
            const fields =
                action === "edit"
                    ? ["expectedRevision", "changes", "secrets"]
                    : action === "add-account"
                      ? ["expectedRevision", "platform", "accountId"]
                      : action === "remove-account"
                        ? ["expectedRevision", "accountKey"]
                        : ["expectedRevision", "accountKey", "protocol", "enabled"];
            if (
                Object.keys(body).length !== fields.length ||
                Object.keys(body).some(key => !fields.includes(key)) ||
                typeof body.expectedRevision !== "string" ||
                !HASH.test(body.expectedRevision)
            )
                invalid();
            if (action === "edit") {
                if (!Array.isArray(body.changes) || !Array.isArray(body.secrets)) invalid();
                // API 和配置服务负责闭合 patch 契约及 Schema；CLI 不重写秘密操作。
                result = await client.editConfigurationDraft(
                    options.get("--draft")!,
                    body as unknown as Parameters<Client["editConfigurationDraft"]>[1],
                );
            } else if (action === "remove-account" || action === "protocol") {
                const accountKey = body.accountKey;
                if (
                    !(action === "protocol" && accountKey === null) &&
                    (typeof accountKey !== "string" ||
                        !accountKey.length ||
                        accountKey.length > 1024)
                )
                    invalid();
                if (action === "remove-account") {
                    result = await client.removeConfigurationAccount(options.get("--draft")!, {
                        expectedRevision: body.expectedRevision,
                        accountKey: accountKey as string,
                    });
                } else {
                    if (
                        typeof body.protocol !== "string" ||
                        !body.protocol.length ||
                        body.protocol.length > 128 ||
                        typeof body.enabled !== "boolean"
                    )
                        invalid();
                    result = await client.setConfigurationProtocol(options.get("--draft")!, {
                        expectedRevision: body.expectedRevision,
                        accountKey: accountKey as string | null,
                        protocol: body.protocol,
                        enabled: body.enabled,
                    });
                }
            } else {
                if (
                    typeof body.platform !== "string" ||
                    !ID.test(body.platform) ||
                    typeof body.accountId !== "string" ||
                    !body.accountId.length ||
                    body.accountId.length > 512
                )
                    invalid();
                result = await client.addConfigurationAccount(options.get("--draft")!, {
                    expectedRevision: body.expectedRevision,
                    platform: body.platform,
                    accountId: body.accountId,
                });
            }
        } else if (action === "validate")
            result = await client.validateConfigurationDraft(
                options.get("--draft")!,
                options.get("--revision")!,
            );
        else if (action === "apply")
            result = await client.applyConfiguration(
                options.get("--request")!,
                options.get("--receipt")!,
            );
        else result = await client.configurationOperation(options.get("--request")!);
        output(JSON.stringify(result));
    } catch (error) {
        if (error instanceof UsageError) throw error;
        // 不回显 JSON 解析错误、服务异常或 argv；其中可能含输入秘密。
        throw new Error("配置命令失败，请检查管理服务状态；重试应用须沿用原操作ID");
    }
}
async function readJson(input: NonNullable<ConfigurationCommandDependencies["stdin"]>) {
    if (input.isTTY) invalid();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of input) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 1_048_576) invalid();
        chunks.push(bytes);
    }
    return parseConfigurationDocument(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
