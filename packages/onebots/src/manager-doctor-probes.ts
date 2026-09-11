import type { ControlDiagnostics } from "@onebots/core/control";
import os from "node:os";
import net from "node:net";
import type { ManagerDoctorCheck } from "./manager-doctor.js";

/** 仅访问管理实例自身报告的监听IP，无凭据、无重定向、无POST。 */
export async function probeManagerWeb(state: ControlDiagnostics): Promise<ManagerDoctorCheck[]> {
    if (!state.management)
        return [{ id: "web", status: "warn", message: "管理服务没有 TCP 监听，未验证 Web。" }];
    let host = state.management.host;
    if (host === "0.0.0.0") host = "127.0.0.1";
    if (host === "::") host = "::1";
    const local =
        host === "::1" ||
        (net.isIP(host) === 4 && host.startsWith("127.")) ||
        Object.values(os.networkInterfaces()).some(entries =>
            entries?.some(entry => entry.address === host),
        );
    if (
        !local ||
        !Number.isInteger(state.management.port) ||
        state.management.port < 1 ||
        state.management.port > 65535
    )
        return [{ id: "web", status: "fail", message: "管理监听地址不属于本机，未发起网络请求。" }];
    const origin = `http://${host.includes(":") ? `[${host}]` : host}:${state.management.port}`;
    const checks: ManagerDoctorCheck[] = [];
    for (const route of ["/healthz", "/ready", "/", "/api/control/status"]) {
        const id =
            route === "/"
                ? "web"
                : route === "/api/control/status"
                  ? "anonymous-access"
                  : route.slice(1);
        try {
            const response = await fetch(origin + route, {
                redirect: "manual",
                signal: AbortSignal.timeout(3000),
            });
            let valid: boolean;
            if (route === "/api/control/status") {
                valid = response.status === 401 || response.status === 403;
                await response.body?.cancel();
            } else {
                const reader = response.body?.getReader();
                const chunks: Uint8Array[] = [];
                let size = 0;
                if (reader)
                    try {
                        for (;;) {
                            const item = await reader.read();
                            if (item.done) break;
                            size += item.value.length;
                            if (size > 131072) throw new Error("响应过大");
                            chunks.push(item.value);
                        }
                    } finally {
                        await reader.cancel();
                    }
                const text = Buffer.concat(chunks).toString("utf8");
                if (route === "/")
                    valid =
                        response.status === 200 &&
                        /text\/html/i.test(response.headers.get("content-type") ?? "") &&
                        /<html[\s>]/i.test(text);
                else {
                    const value = JSON.parse(text);
                    valid =
                        response.status === 200 &&
                        value.application === "onebots" &&
                        value.instance_id === state.manager.id &&
                        value.ready === true;
                }
            }
            checks.push({
                id,
                status: valid ? "pass" : "fail",
                message: valid ? "管理端检查通过。" : "管理端响应不符合预期。",
            });
            if (!valid && ["/healthz", "/ready"].includes(route)) break;
        } catch {
            checks.push({ id, status: "fail", message: "管理端请求失败、超时或响应无效。" });
            if (["/healthz", "/ready"].includes(route)) break;
        }
    }
    return checks;
}
