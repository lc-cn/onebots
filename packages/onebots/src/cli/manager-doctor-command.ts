import { runManagerDoctor } from "../manager-doctor.js";
import type { ServiceHost } from "../service-host.js";
import type { CommandResult } from "./command-application.js";
export interface ManagerDoctorCommandOptions {
    dataDir?: string;
    system?: boolean;
    strict?: boolean;
    fix?: boolean;
    json?: boolean;
}
export async function managerDoctorCommand(
    options: ManagerDoctorCommandOptions,
    host?: ServiceHost,
): Promise<CommandResult> {
    let report: Awaited<ReturnType<typeof runManagerDoctor>>;
    if (options.fix) {
        report = {
            schemaVersion: 1,
            checks: [
                {
                    id: "fix",
                    status: "fail",
                    message:
                        "新管理服务诊断不执行 --fix；请使用配置修复、migrate 或 recover 显式操作，未更改文件或服务。",
                },
            ],
            exitCode: 1,
        };
    } else {
        try {
            report = await runManagerDoctor(
                {
                    dataDir: options.dataDir,
                    system: options.system,
                    strict: options.strict,
                    fix: false,
                },
                host,
            );
        } catch {
            report = {
                schemaVersion: 1,
                checks: [
                    {
                        id: "diagnostic",
                        status: "fail",
                        message: "诊断未完成；未验证项目不能视为通过，请检查本机管理服务与工作区。",
                    },
                ],
                exitCode: 1,
            };
        }
    }
    return {
        output: options.json
            ? JSON.stringify(report)
            : report.checks
                  .map(
                      check =>
                          `${check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✗"} ${check.id}: ${check.message}`,
                  )
                  .join("\n"),
        exitCode: report.exitCode,
        raw: options.json === true,
    };
}
