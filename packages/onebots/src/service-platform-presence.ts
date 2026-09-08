import { LAUNCHD_LABEL, SERVICE_NAME, type ServiceScope } from "./service-definition.js";
import type { ServiceHost } from "./service-host.js";

const ABSENT_SYSTEMD = {
    LoadState: "not-found",
    ActiveState: "inactive",
    SubState: "dead",
    MainPID: "0",
    ControlPID: "0",
    ControlGroup: "",
    FragmentPath: "",
} as const;
function validUid(uid: unknown): uid is number {
    return Number.isSafeInteger(uid) && Number(uid) >= 0 && Number(uid) < 0xffffffff;
}

/** 与 launchd 状态驱动共用精确缺失判定，不能仅匹配退出码或输出片段。 */
export function isLaunchdServiceMissing(
    error: unknown,
    scope: ServiceScope,
    uid?: number,
): boolean {
    if (scope !== "system" && (scope !== "user" || !validUid(uid))) return false;
    if (!error || typeof error !== "object") return false;
    const failure = error as { status?: unknown; stderr?: unknown };
    const stderr = Buffer.isBuffer(failure.stderr)
        ? failure.stderr.toString("utf8")
        : failure.stderr;
    const domain = scope === "system" ? "system" : `user gui: ${uid}`;
    return (
        failure.status === 113 &&
        stderr ===
            `Bad request.\nCould not find service "${LAUNCHD_LABEL}" in domain for ${domain}\n`
    );
}

/** 首次安装前或卸载验收时在服务锁内调用；不存在只能由固定 OS 身份的明确结果证明。 */
export function assertServiceAbsent(scope: ServiceScope, host: ServiceHost): void {
    try {
        if (!["user", "system"].includes(scope) || (scope === "user" && !validUid(host.uid)))
            throw new Error();
        if (host.platform === "darwin") {
            const domain = scope === "system" ? "system" : `gui/${host.uid}`;
            try {
                host.exec("/bin/launchctl", ["print", `${domain}/${LAUNCHD_LABEL}`], {
                    timeoutMs: 5000,
                });
            } catch (error) {
                if (isLaunchdServiceMissing(error, scope, host.uid)) return;
                throw new Error();
            }
            throw new Error(); // print 成功意味着身份存在，即使没有PID也不能安装覆盖。
        }
        if (host.platform !== "linux") throw new Error();
        const expected = Object.entries(ABSENT_SYSTEMD);
        const output = host.exec(
            "systemctl",
            [
                "--no-pager",
                "--no-ask-password",
                ...(scope === "user" ? ["--user"] : []),
                "show",
                `--property=${expected.map(([key]) => key).join(",")}`,
                "--",
                `${SERVICE_NAME}.service`,
            ],
            { timeoutMs: 5000 },
        );
        if (output.length > 8192 || /[\u0000\r]/.test(output)) throw new Error();
        const lines = output.split("\n");
        if (lines.at(-1) === "") lines.pop();
        const properties = new Map<string, string>();
        for (const line of lines) {
            const separator = line.indexOf("=");
            if (separator < 1) throw new Error();
            const key = line.slice(0, separator);
            if (!Object.hasOwn(ABSENT_SYSTEMD, key) || properties.has(key)) throw new Error();
            properties.set(key, line.slice(separator + 1));
        }
        if (
            properties.size !== expected.length ||
            expected.some(([key, value]) => properties.get(key) !== value)
        )
            throw new Error();
    } catch {
        throw new Error("无法证明系统服务不存在，禁止首次安装覆盖");
    }
}
