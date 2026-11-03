import fs from "node:fs";
import path from "node:path";
import { writeCliOutput } from "../cli-output.js";
import { createDefaultServiceHost } from "../service-host.js";
import { defaultServiceAuthorityDirectory } from "../service-authority.js";
import { planWorkspaceRegistration } from "./registration-plan.js";
import { registerWorkspace, resumeWorkspaceRegistration } from "./registration.js";
import { inspectWorkspaceAdmission } from "./admission.js";

export async function runWorkspaceCommand(args: string[]): Promise<void> {
    const [action, ...rest] = args;
    if (["--help", "-h"].includes(action) || !action) {
        writeCliOutput(
            "onebots workspace plan|inspect --data-dir 工作区 [--authority-dir 卷外目录]\n保存 plan 的 JSON，然后 workspace register --plan-file 文件 --confirm 计划digest；中断后 workspace resume --request 请求ID --data-dir 工作区 --authority-dir 原目录。登记前必须停止管理服务；不会启动网关，不支持重绑/接管。首次登记使旧管理会话和未兑换码失效，业务账号会话不改。",
        );
        return;
    }
    const values = new Map<string, string>();
    for (let index = 0; index < rest.length; index += 2) {
        const name = rest[index],
            value = rest[index + 1];
        if (
            !["--data-dir", "--authority-dir", "--plan-file", "--confirm", "--request"].includes(
                name,
            ) ||
            values.has(name) ||
            !value ||
            value.startsWith("--") ||
            /[\0\r\n]/.test(value)
        )
            throw new Error("workspace 参数无效或重复，请运行 onebots workspace --help");
        values.set(name, value);
    }
    const checkOptions = (allowed: string[]) => {
        if ([...values.keys()].some(name => !allowed.includes(name)))
            throw new Error("此 workspace 操作不接受这些参数");
    };
    if (action === "register") {
        checkOptions(["--plan-file", "--confirm"]);
        const file = values.get("--plan-file"),
            confirmation = values.get("--confirm");
        if (!file || !confirmation)
            throw new Error("登记需要 --plan-file 和明确的 --confirm 计划摘要");
        let plan: unknown;
        try {
            plan = JSON.parse(fs.readFileSync(file === "-" ? 0 : file, "utf8"));
        } catch {
            throw new Error("登记计划无法读取或不是有效 JSON");
        }
        writeCliOutput(JSON.stringify(await registerWorkspace(plan, confirmation)));
        return;
    }
    checkOptions(
        action === "resume"
            ? ["--data-dir", "--authority-dir", "--request"]
            : ["--data-dir", "--authority-dir"],
    );
    const workspace = path.resolve(
        values.get("--data-dir") ?? process.env.ONEBOTS_WORKSPACE ?? process.cwd(),
    );
    const authority = path.resolve(
        values.get("--authority-dir") ??
            defaultServiceAuthorityDirectory("user", createDefaultServiceHost()),
    );
    if (action === "plan")
        writeCliOutput(JSON.stringify(await planWorkspaceRegistration(workspace, authority)));
    else if (action === "inspect")
        writeCliOutput(JSON.stringify(inspectWorkspaceAdmission(workspace, authority)));
    else if (action === "resume") {
        const requestId = values.get("--request");
        if (!requestId) throw new Error("续办需要原 --request ID");
        writeCliOutput(
            JSON.stringify(await resumeWorkspaceRegistration(workspace, authority, requestId)),
        );
    } else throw new Error("workspace 操作应为 plan、register、resume 或 inspect");
}
