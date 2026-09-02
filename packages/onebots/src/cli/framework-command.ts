import {
    createFrameworkConnectionPlan,
    getFrameworkProfile,
    listFrameworkProfiles,
    type FrameworkId,
} from "../framework-integration.js";
import { CliError, type CommandResult } from "./command-application.js";

export interface FrameworkCommandOptions {
    framework?: string;
    account?: string;
    origin?: string;
    framework_origin?: string;
    json: boolean;
}

/** 列出框架接入面，或为指定账号生成两端配置与验证步骤。 */
export function showFrameworkConnections(options: FrameworkCommandOptions): CommandResult {
    if (!options.framework) {
        if (options.account || options.framework_origin) {
            throw new CliError("--account 和 --framework_origin 只能与 --framework 一起使用");
        }
        const profiles = listFrameworkProfiles();
        return {
            output: options.json
                ? JSON.stringify({ schemaVersion: 1, profiles }, null, 2)
                : formatFrameworkProfileList(profiles),
            raw: options.json,
        };
    }
    const profile = getFrameworkProfile(options.framework);
    if (!profile) {
        throw new CliError(
            `未知机器人框架：${options.framework}。可选值：${listFrameworkProfiles()
                .map(item => item.id)
                .join(", ")}`,
        );
    }
    if (!options.account) {
        throw new CliError(
            `生成 ${profile.displayName} 接入方案需要 --account platform.account_id`,
        );
    }
    let plan;
    try {
        plan = createFrameworkConnectionPlan({
            framework: profile.id as FrameworkId,
            account: options.account,
            onebotsOrigin: options.origin,
            frameworkOrigin: options.framework_origin,
        });
    } catch (error) {
        throw new CliError(error instanceof Error ? error.message : String(error));
    }
    return {
        output: options.json ? JSON.stringify(plan, null, 2) : formatFrameworkConnectionPlan(plan),
        raw: options.json,
    };
}

function formatFrameworkProfileList(profiles: ReturnType<typeof listFrameworkProfiles>): string {
    return [
        "机器人框架接入基线（上游接入面不等于 OneBots 已验证）",
        ...profiles.map(
            profile =>
                `${profile.id.padEnd(9)} ${profile.protocol.padEnd(12)} ${profile.transport.padEnd(17)} ${profile.verification}`,
        ),
        "生成配置: onebots frameworks --framework <name> --account <platform.account_id>",
    ].join("\n");
}

function formatFrameworkConnectionPlan(
    plan: ReturnType<typeof createFrameworkConnectionPlan>,
): string {
    return [
        `${plan.framework.displayName} 接入方案`,
        `状态: ${plan.framework.verification}（上游接入面不等于 OneBots 已验证）`,
        `协议: ${plan.protocol}`,
        `传输: ${plan.transport}`,
        `端点: ${plan.endpoint}`,
        "",
        "OneBots 配置:",
        plan.onebotsConfig.trimEnd(),
        "",
        `${plan.framework.displayName} 配置:`,
        plan.frameworkConfig.trimEnd(),
        "",
        "验证:",
        ...plan.checks.map(check =>
            check.command
                ? `- ${check.name}: ${check.command}；期望 ${check.expected}`
                : `- ${check.name}: ${check.expected}`,
        ),
        ...(plan.limitations.length
            ? ["", "已知限制:", ...plan.limitations.map(item => `- ${item}`)]
            : []),
    ].join("\n");
}
