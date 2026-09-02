import { RouterContext, ValidationError } from "@onebots/core";
import type { Router } from "@onebots/core";
import type { App } from "../app.js";
import {
    createFrameworkConnectionPlan,
    getFrameworkProfile,
    listFrameworkProfiles,
    type FrameworkId,
} from "../framework-integration.js";
import { setManagementEvidenceIdentity } from "../management-evidence-identity.js";
import { listFrameworkEcosystem } from "../framework-ecosystem.js";

export function registerFrameworkRoutes(app: App, router: Router): void {
    router.get("/api/frameworks", (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        ctx.body = {
            schemaVersion: 1,
            frameworks: listFrameworkProfiles(),
            ecosystem: listFrameworkEcosystem(),
        };
    });

    router.post("/api/frameworks/plan", (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        try {
            const body = requireRecord(ctx.request.body);
            const framework = requireString(body.framework, "framework");
            if (!getFrameworkProfile(framework))
                throw new ValidationError(`未知机器人框架：${framework}`);
            ctx.body = createFrameworkConnectionPlan({
                framework: framework as FrameworkId,
                account: requireString(body.account, "account"),
                onebotsOrigin: optionalString(body.onebotsOrigin, "onebotsOrigin"),
                frameworkOrigin: optionalString(body.frameworkOrigin, "frameworkOrigin"),
            });
        } catch (error) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                code: "FRAMEWORK_PLAN_INVALID",
                message: error instanceof Error ? error.message : "框架接入参数无效",
            };
        }
    });
}

function requireRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ValidationError("请求体必须是对象");
    }
    return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new ValidationError(`${name} 必须是非空字符串`);
    }
    return value;
}

function optionalString(value: unknown, name: string): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    return requireString(value, name);
}
