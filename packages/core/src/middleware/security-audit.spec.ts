import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Context } from "koa";
import { afterEach, describe, expect, it } from "vitest";
import {
    closeSecurityAudit,
    initSecurityAudit,
    logInvalidToken,
    securityAudit,
} from "./security-audit.js";

const directories: string[] = [];

afterEach(async () => {
    await closeSecurityAudit().catch(() => undefined);
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function fixture(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-security-audit-"));
    directories.push(directory);
    return directory;
}

function requestContext(): Context {
    return {
        ip: "127.0.0.1",
        request: { ip: "127.0.0.1" },
        status: 200,
        path: "/api/system",
        method: "GET",
        get: () => "vitest",
    } as unknown as Context;
}

describe("security audit shutdown", () => {
    it("关闭返回前刷新排队中的审计记录，并允许重复关闭", async () => {
        const directory = fixture();
        initSecurityAudit(directory);

        await securityAudit()(requestContext(), async () => undefined);
        await expect(closeSecurityAudit()).resolves.toBeUndefined();
        await expect(closeSecurityAudit()).resolves.toBeUndefined();

        const files = fs.readdirSync(directory);
        expect(files).toHaveLength(1);
        const content = fs.readFileSync(path.join(directory, files[0]), "utf8");
        expect(content).toContain('"type":"auth_success"');
        expect(content).toContain('"path":"/api/system"');
    });

    it("写入目录在流打开前消失时把错误交给关闭调用方", async () => {
        const directory = fixture();
        initSecurityAudit(directory);
        fs.rmSync(directory, { recursive: true, force: true });

        await expect(closeSecurityAudit()).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("无效令牌审计只保留进程内指纹，不保存任何明文前缀", async () => {
        const directory = fixture();
        const token = "super-secret-token-value";
        initSecurityAudit(directory);

        logInvalidToken(requestContext(), token);
        await closeSecurityAudit();

        const file = path.join(directory, fs.readdirSync(directory)[0]);
        const content = fs.readFileSync(file, "utf8");
        expect(content).not.toContain(token);
        expect(content).not.toContain(token.slice(0, 10));
        const event = JSON.parse(content) as { details: { token: Record<string, unknown> } };
        expect(event.details.token).toEqual({
            present: true,
            fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/u),
        });
    });
});
