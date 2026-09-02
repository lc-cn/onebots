import { ApplicationRegistry, RouterContext, ValidationError } from "@onebots/core";
import type { Router } from "@onebots/core";
import { App } from "../app.js";
import {
    createFrameworkConnectionPlan,
    getFrameworkProfile,
    listFrameworkProfiles,
    type FrameworkId,
} from "../framework-integration.js";
import { setManagementEvidenceIdentity } from "../management-evidence-identity.js";
import { listFrameworkEcosystem } from "../framework-ecosystem.js";
import { loadFrameworkIntegration } from "../framework-integration-loader.js";

export function registerFrameworkRoutes(app: App, router: Router): void {
    router.get("/api/applications", (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        ctx.body = {
            schemaVersion: 1,
            registered: ApplicationRegistry.getNames().map(name => ({
                name,
                active: ApplicationRegistry.getActiveNames().includes(name),
                ...applicationMetadata(name),
            })),
            active: ApplicationRegistry.listActive(),
            protocols: listRuntimeApplicationCapabilities(app),
        };
    });

    router.post("/api/applications/load", async (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        try {
            const body = requireRecord(ctx.request.body);
            const name = requireString(body.application, "application");
            if (!(await App.loadApplicationFactory(name))) {
                throw new ValidationError(`无法加载应用 ${name}`);
            }
            ctx.body = {
                success: true,
                application: name,
                registered: true,
                active: ApplicationRegistry.listActive(),
                protocols: listRuntimeApplicationCapabilities(app),
                restartRequired: true,
                activationCommand: `onebots -t ${name}`,
            };
        } catch (error) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                code: "APPLICATION_LOAD_FAILED",
                message: error instanceof Error ? error.message : "应用加载失败",
            };
        }
    });

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

    router.post("/api/frameworks/load", async (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        try {
            const body = requireRecord(ctx.request.body);
            const loaded = await loadFrameworkIntegration(requireString(body.provider, "provider"));
            ctx.body = {
                success: true,
                loaded,
                frameworks: listFrameworkProfiles(),
            };
        } catch (error) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                code: "FRAMEWORK_PROVIDER_LOAD_FAILED",
                message: error instanceof Error ? error.message : "框架方案加载失败",
            };
        }
    });
}

function applicationMetadata(name: string) {
    const definition = ApplicationRegistry.get(name);
    return definition
        ? {
              displayName: definition.displayName,
              description: definition.description,
              stage: definition.stage ?? "available",
              homepage: definition.homepage,
          }
        : {};
}

function listRuntimeApplicationCapabilities(app: App) {
    return [...app.adapters.values()].flatMap(adapter =>
        [...adapter.accounts.values()].flatMap(account =>
            account.protocols.map(protocol => ({
                platform: String(adapter.platform),
                accountId: account.account_id,
                protocol: `${protocol.name}.${protocol.version}`,
                path: protocol.path,
                lifecycleStatus: protocol.lifecycleStatus,
                applications: ApplicationRegistry.describeProtocol(protocol),
            })),
        ),
    );
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
