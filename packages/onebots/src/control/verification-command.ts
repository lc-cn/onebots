import path from "node:path";
import { isControlVerificationCommand, type ControlClient } from "@onebots/core/control";
import { createLocalControlClient } from "../client/local-control.js";
import { writeCliOutput } from "../cli-output.js";

export const VERIFICATION_HELP = `onebots control verification <命令> [--data-dir 工作区]
  pending                         查询当前账号验证挑战
  execute --stdin                 管道 JSON：operationId、challengeId、expected、action、data
  operation --request UUID        查询原验证回执（网关离线也可查询）
验证码只接受非终端 stdin，不接受命令行参数，不保存到配置。
提交前自行保留 operationId。提交失去确认后只查询原回执，不换 ID 自动重试。
succeeded 仅表示验证调用完成，不代表账号已上线。`;

interface Dependencies {
    createClient?(workspace: string): {
        verification: Pick<ControlClient["verification"], "pending" | "execute" | "operation">;
    };
    stdin?: AsyncIterable<Buffer | string> & { isTTY?: boolean };
    output?(message: string): void;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function runVerificationCommand(
    args: string[],
    dependencies: Dependencies = {},
): Promise<void> {
    const output = dependencies.output ?? writeCliOutput;
    if (!args.length || (args.length === 1 && ["help", "--help", "-h"].includes(args[0]))) {
        output(VERIFICATION_HELP);
        return;
    }
    const [action, ...rest] = args;
    const allowed: Record<string, string[]> = {
        pending: [],
        execute: ["--stdin"],
        operation: ["--request"],
    };
    const invalid = () => new Error(`账号验证命令参数无效。\n${VERIFICATION_HELP}`);
    if (!Object.hasOwn(allowed, action)) throw invalid();
    const options = new Map<string, string>();
    for (let index = 0; index < rest.length; index++) {
        const key = rest[index];
        if (![...allowed[action], "--data-dir"].includes(key) || options.has(key)) throw invalid();
        if (key === "--stdin") options.set(key, "true");
        else {
            const value = rest[++index];
            if (!value || value.startsWith("--")) throw invalid();
            options.set(key, value);
        }
    }
    if (allowed[action].some(key => !options.has(key))) throw invalid();
    const id = options.get("--request");
    if (action === "operation" && (!id || !uuid.test(id))) throw invalid();
    let operationId = id;
    try {
        const workspace = path.resolve(
            options.get("--data-dir") ?? process.env.ONEBOTS_WORKSPACE ?? process.cwd(),
        );
        const client = (dependencies.createClient ?? createLocalControlClient)(
            workspace,
        ).verification;
        let result: unknown;
        if (action === "pending") result = await client.pending();
        else if (action === "operation") result = await client.operation(id!);
        else {
            const input = dependencies.stdin ?? process.stdin;
            if (input.isTTY) throw invalid();
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of input) {
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                size += bytes.length;
                if (size > 131072) throw invalid();
                chunks.push(bytes);
            }
            let command: unknown;
            try {
                command = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } finally {
                for (const chunk of chunks) chunk.fill(0);
            }
            if (!isControlVerificationCommand(command)) throw invalid();
            operationId = command.operationId;
            result = await client.execute(command);
        }
        output(JSON.stringify(result));
    } catch {
        // 不回显解析或服务错误，其中可能带有验证码；只提供经过格式校验的操作 ID。
        throw new Error(
            operationId
                ? `验证结果未确认。请查询 onebots control verification operation --request ${operationId}，勿重新提交。`
                : "账号验证命令失败，请检查参数与管理服务状态；验证码只能从非终端 stdin 输入。",
        );
    }
}
