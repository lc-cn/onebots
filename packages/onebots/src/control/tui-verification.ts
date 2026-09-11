import { randomUUID } from "node:crypto";
import { controlVerificationOutcome } from "@onebots/core/control";
import type {
    ControlClient,
    ControlVerificationCommand,
    ControlVerificationOperation,
} from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";

/** 平台提示不得改变终端状态，也不自动打开平台提供的网址。 */
export function verificationTerminalText(value: string): string {
    return value
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, "")
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
        .replace(/[\x00-\x1f\x7f-\x9f]/gu, " ")
        .slice(0, 8192);
}
function safeLink(value: string): string | undefined {
    try {
        const url = new URL(value);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
        return verificationTerminalText(url.href);
    } catch {
        // 不展示无法确认安全的网址，也不输出平台原始异常。
        return undefined;
    }
}
function reportOperation(prompt: TuiPrompt, operation: ControlVerificationOperation): void {
    const labels = {
        running: "处理中，请查询原回执",
        succeeded: "验证操作已提交，不代表账号已登录",
        rejected: "操作被拒绝",
        unknown: "结果未确认，请勿重新提交或重复发送短信",
        acknowledged: "已接受未知结果，仅解除阻塞，不代表执行成功",
    };
    prompt.report(`操作 ${operation.id}：${labels[controlVerificationOutcome(operation)]}`);
}
export async function queryControlVerification(
    client: ControlClient,
    prompt: TuiPrompt,
): Promise<void> {
    const [id] = await prompt.ask({ title: "输入已有验证操作 ID" });
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(id ?? "")) {
        prompt.report("操作 ID 无效。");
        return;
    }
    let operation: ControlVerificationOperation;
    try {
        operation = await client.verification.operation(id);
    } catch {
        await recoverMissingReceipt(client, prompt, id);
        return;
    }
    try {
        reportOperation(prompt, operation);
        if (operation.status !== "unknown" || operation.resolution || operation.acknowledgement)
            return;
        const [confirm] = await prompt.ask({
            title: "处理未知验证结果",
            detail: "核对只查询原网关。接受未知结果需先自行停止网关；可能已执行短信或登录，接受不会撤销，也不会重新提交。",
            choices: [
                { value: "no", label: "返回" },
                { value: "yes", label: "核对网关原回执" },
                { value: "acknowledge", label: "停止网关后接受未知结果" },
            ],
        });
        if (confirm === "yes") reportOperation(prompt, await client.verification.reconcile(id));
        if (confirm === "acknowledge") {
            const [accepted] = await prompt.ask({
                title: "明确接受未知结果风险？",
                detail: "短信或登录可能已经执行，无法因此撤销。仅解除阻塞，不代表成功，不停止网关、不重新提交；服务端将检查网关已停止。",
                choices: [
                    { value: "no", label: "取消" },
                    { value: "yes", label: "我理解并接受未知结果" },
                ],
            });
            if (accepted === "yes")
                reportOperation(prompt, await client.verification.acknowledge(id, true));
        }
    } catch {
        prompt.report("原回执暂不可查询。请保留操作 ID，不要重新提交。");
    }
}
async function recoverMissingReceipt(
    client: ControlClient,
    prompt: TuiPrompt,
    id: string,
): Promise<void> {
    try {
        const receipt = await client.verification.abandonment(id);
        prompt.report(
            `操作 ${id} 已于 ${receipt.abandonedAt} 封存，迟到请求将被拒绝；不表示平台从未发生过动作。`,
        );
        return;
    } catch {
        // 查询失败不是不存在的证明，只有服务端封存事务可以决定是否允许恢复。
    }
    const [choice] = await prompt.ask({
        title: "原回执暂不可查询",
        detail: "查询失败不代表未执行。请保留编号；服务端只有在原操作未受理且网关完全停止时才允许封存。",
        choices: [
            { value: "no", label: "返回并保留编号" },
            { value: "abandon", label: "停止网关后封存未受理编号" },
        ],
    });
    if (choice !== "abandon") return;
    const [confirmed] = await prompt.ask({
        title: "确认永久封存这个编号？",
        detail: "封存后迟到请求永久拒绝，不表示平台从未发生过动作；不会停止网关、重新提交或删除历史编号。",
        choices: [
            { value: "no", label: "取消" },
            { value: "yes", label: "我理解并确认封存" },
        ],
    });
    if (confirmed !== "yes") return;
    try {
        const receipt = await client.verification.abandon(id, true);
        prompt.report(
            `操作 ${id} 已于 ${receipt.abandonedAt} 封存；请保留编号，不表示平台从未发生过动作。`,
        );
    } catch {
        prompt.report(`封存未确认，请继续查询原编号 ${id}；不要重新提交或清除记录。`);
    }
}
export async function runControlVerification(
    client: ControlClient,
    prompt: TuiPrompt,
): Promise<void> {
    const snapshot = await client.verification.pending();
    const challenges = snapshot.challenges.filter(item => item.expiresAt > Date.now());
    if (!challenges.length) {
        prompt.report("暂无待处理的账号验证。");
        return;
    }
    const [selected] = await prompt.ask({
        title: "选择账号验证",
        choices: [
            ...challenges.map(item => ({
                value: item.id,
                label: verificationTerminalText(
                    `${item.request.platform} / ${item.request.account_id} · ${item.request.type}`,
                ),
            })),
            { value: "$back", label: "返回" },
        ],
    });
    const challenge = challenges.find(item => item.id === selected);
    if (!challenge) return;
    const request = challenge.request;
    prompt.report(verificationTerminalText(request.hint));
    const blocks = request.options?.blocks ?? [];
    for (const block of blocks) {
        if (block.type === "text") prompt.report(verificationTerminalText(block.content));
        else if (block.type === "qrcode")
            prompt.report(
                `二维码内容（仅文本，不会自动打开）：${verificationTerminalText(block.content)}`,
            );
        else if (block.type === "link" || block.type === "image_url") {
            const link = safeLink(block.url);
            prompt.report(
                link
                    ? `请自行核对后访问：${link}`
                    : "平台提供的网址无法安全展示，请通过 Web 查看验证提示。",
            );
        } else if (block.type === "image")
            prompt.report("平台提供了验证图片，请在 Web 控制台查看。");
    }
    const inputs = blocks.filter(block => block.type === "input");
    const [action] = await prompt.ask({
        title: "选择验证操作",
        choices: [
            ...(inputs.length || request.confirmable
                ? [
                      {
                          value: "submit",
                          label: verificationTerminalText(request.confirmLabel ?? "提交验证"),
                      },
                  ]
                : []),
            ...(request.requestSmsAvailable ? [{ value: "sms", label: "发送短信验证码" }] : []),
            ...(request.actions ?? []).map((item, index) => ({
                value: `action:${index}`,
                label: verificationTerminalText(item.label),
            })),
            { value: "$back", label: "返回" },
        ],
    });
    const data: Record<string, string> = Object.create(null);
    if (action === "submit") {
        for (const input of inputs) {
            const [answer] = await prompt.ask({
                title: verificationTerminalText(input.placeholder ?? input.key),
                secret: true,
            });
            if (!answer || answer.length > (input.maxLength ?? 16384)) {
                prompt.report("验证输入为空或超过长度限制，未提交。");
                return;
            }
            data[input.key] = answer;
        }
    } else if (action.startsWith("action:")) {
        const declared = request.actions?.[Number(action.slice(7))];
        if (!declared) return;
        data.action = declared.id;
    } else if (action !== "sms" || !request.requestSmsAvailable) return;
    const [confirmed] = await prompt.ask({
        title: "确认执行此次验证操作？",
        detail: "只提交一次。结果未确认时查询原操作，不会自动重试。",
        choices: [
            { value: "no", label: "取消" },
            { value: "yes", label: "确认" },
        ],
    });
    if (confirmed !== "yes" || challenge.expiresAt <= Date.now()) {
        prompt.report("已取消或验证已过期，未提交。");
        return;
    }
    const command: ControlVerificationCommand = {
        operationId: randomUUID(),
        challengeId: challenge.id,
        expected: {
            gatewayInstanceId: snapshot.gatewayInstanceId,
            configVersion: snapshot.configVersion,
        },
        action: action === "sms" ? "request-sms" : "submit",
        ...(action === "sms" ? {} : { data }),
    };
    prompt.report(`请保存验证操作 ID：${command.operationId}`);
    try {
        reportOperation(prompt, await client.verification.execute(command));
    } catch {
        prompt.report(
            `结果未确认。请查询原操作 ${command.operationId}，不要重新提交或重复发送短信。`,
        );
    } finally {
        for (const key of Object.keys(data)) delete data[key];
    }
}
