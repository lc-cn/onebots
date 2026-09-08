import http from "node:http";
import net from "node:net";
import { z } from "zod";
import semver from "semver";
import type { ControlDiagnostics } from "@onebots/core/control";
import { inspectPrivateControlSocket } from "./service-migration-manager.js";
import { controlSocket } from "./control/workspace.js";

const diagnostics = z
    .object({
        schemaVersion: z.literal(1),
        manager: z
            .object({
                id: z.string().uuid(),
                pid: z.number().int().min(1).max(2147483647),
                version: z
                    .string()
                    .max(64)
                    .refine(value => semver.valid(value) === value),
            })
            .strict(),
        management: z
            .object({
                host: z.string().refine(value => net.isIP(value) !== 0),
                port: z.number().int().min(1).max(65535),
            })
            .strict()
            .nullable(),
        gateway: z
            .object({
                actual: z.enum(["starting", "running", "stopping", "stopped", "failed"]),
                desired: z.enum(["running", "stopped"]),
                recoveryRequired: z.boolean(),
            })
            .strict(),
        configuration: z
            .object({
                state: z.enum(["ready", "damaged", "unavailable"]),
                recoveryRequired: z.boolean(),
            })
            .strict(),
        generation: z
            .object({
                activeId: z
                    .string()
                    .max(128)
                    .regex(/^[A-Za-z0-9_-]+$/)
                    .nullable(),
                recoveryRequired: z.boolean(),
            })
            .strict(),
        processOwnership: z.object({ available: z.boolean() }).strict(),
        serviceMigration: z
            .object({ pending: z.boolean(), recoveryRequired: z.boolean() })
            .strict(),
    })
    .strict();

/** 固定本机只读路由，4秒总期限与64KiB上限；不复用可等待长事务的客户端超时。 */
export async function inspectManagerDiagnostics(workspace: string): Promise<ControlDiagnostics> {
    const identity = inspectPrivateControlSocket(workspace);
    const body = await new Promise<Buffer>((resolve, reject) => {
        const request = http.get(
            { socketPath: controlSocket(workspace), path: "/api/control/diagnostics" },
            response => {
                if (response.statusCode !== 200) {
                    response.destroy();
                    reject(new Error("管理诊断不可用"));
                    return;
                }
                let size = 0;
                const chunks: Buffer[] = [];
                response.on("data", (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > 65536) response.destroy(new Error("管理诊断响应过大"));
                    else chunks.push(chunk);
                });
                response.on("error", reject);
                response.on("end", () => resolve(Buffer.concat(chunks)));
            },
        );
        const timer = setTimeout(() => request.destroy(new Error("管理诊断超时")), 4000);
        timer.unref();
        request.on("error", reject);
        request.once("close", () => clearTimeout(timer));
    });
    if (inspectPrivateControlSocket(workspace) !== identity) throw new Error("管理实例已变化");
    const parsed = diagnostics.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)),
    );
    return {
        ...parsed,
        management: parsed.management ?? null,
        generation: { ...parsed.generation, activeId: parsed.generation.activeId ?? null },
    };
}
