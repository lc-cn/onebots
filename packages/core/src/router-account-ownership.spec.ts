import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Account, AccountStatus } from "./account.js";
import { Adapter } from "./adapter.js";
import { BaseApp } from "./base-app.js";
import { AdapterRegistry } from "./registry.js";

describe("Router account ownership", () => {
    it("热重载路由冲突报告双方账号并恢复旧账号路由", async () => {
        const originalConfigDir = BaseApp.configDir;
        const originalPort = process.env.PORT;
        const directory = mkdtempSync(join(tmpdir(), "onebots-route-owner-"));
        BaseApp.configDir = directory;
        process.env.PORT = "0";

        class OwnedRouteAdapter extends Adapter {
            constructor(app: BaseApp) {
                super(app, "route_owner_test" as never);
            }

            createAccount(accountConfig: Account.Config): Account {
                const account = new Account(this, {}, accountConfig);
                const route = String(accountConfig.route);
                this.app.router.post(`/route-owner/${route}`, ctx => {
                    ctx.body = { marker: accountConfig.account_id };
                });
                account.on("start", () => {
                    account.status = AccountStatus.Online;
                });
                account.on("stop", () => {
                    account.status = AccountStatus.OffLine;
                });
                return account;
            }
        }

        AdapterRegistry.register("route_owner_test", OwnedRouteAdapter as never);
        const app = new BaseApp({
            database: "route-owner.db",
            "route_owner_test.primary": { route: "primary" },
            "route_owner_test.secondary": { route: "secondary" },
        } as BaseApp.Config);

        try {
            await app.start();
            const error = await app
                .reload({
                    ...app.config,
                    "route_owner_test.primary": { route: "shared" },
                    "route_owner_test.secondary": { route: "shared" },
                } as BaseApp.Config)
                .catch(value => value);

            expect(error).toMatchObject({
                cause: {
                    name: "HttpRouteConflictError",
                    path: "/route-owner/shared",
                    registeringOwner: {
                        platform: "route_owner_test",
                        account_id: "secondary",
                    },
                    existingOwner: {
                        platform: "route_owner_test",
                        account_id: "primary",
                    },
                },
            });
            expect(app.config["route_owner_test.primary"]).toMatchObject({ route: "primary" });
            expect(app.config["route_owner_test.secondary"]).toMatchObject({ route: "secondary" });
            expect(
                app.router.stack.filter(layer => layer.path === "/route-owner/primary"),
            ).toHaveLength(1);
            expect(
                app.router.stack.filter(layer => layer.path === "/route-owner/secondary"),
            ).toHaveLength(1);
            expect(
                app.router.stack.filter(layer => layer.path === "/route-owner/shared"),
            ).toHaveLength(0);
        } finally {
            await app.stop();
            AdapterRegistry.unregister("route_owner_test");
            BaseApp.configDir = originalConfigDir;
            if (originalPort === undefined) delete process.env.PORT;
            else process.env.PORT = originalPort;
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
