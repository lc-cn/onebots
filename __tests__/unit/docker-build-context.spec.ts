import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Docker 构建上下文", () => {
    test("在构建工作空间前复制子包继承的根 TypeScript 配置", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        const rootConfigCopy = dockerfile.indexOf(
            "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./",
        );
        const workspaceBuild = dockerfile.indexOf("RUN pnpm build:packages");

        expect(rootConfigCopy).toBeGreaterThanOrEqual(0);
        expect(workspaceBuild).toBeGreaterThan(rootConfigCopy);
    });

    test("运行镜像包含基于 readiness 的健康检查", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");

        expect(dockerfile).toContain(
            "COPY --chown=node:node scripts/docker-healthcheck.mjs ./scripts/docker-healthcheck.mjs",
        );
        expect(dockerfile).toContain(
            'HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/app/scripts/docker-healthcheck.mjs"]',
        );
    });

    test("运行镜像以 node 用户持有应用文件，并在入口中降权", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");

        expect(dockerfile).toContain("ENV COREPACK_HOME=/usr/local/share/corepack");
        expect(dockerfile).toContain("apk add --no-cache su-exec");
        expect(dockerfile).toContain('chown -R node:node "$COREPACK_HOME"');
        expect(dockerfile).toContain("chown -R node:node /data");
        expect(dockerfile).toContain("COPY --chown=node:node --from=builder");
        expect(dockerfile).toContain(
            "COPY --chown=node:node scripts/docker-healthcheck.mjs ./scripts/docker-healthcheck.mjs",
        );

        for (const entrypoint of ["docker-entrypoint.sh", "docker-entrypoint-hf.sh"]) {
            const source = await readFile(resolve(repositoryRoot, entrypoint), "utf8");
            expect(source).toContain('if [ "$(id -u)" = "0" ]; then');
            expect(source).toContain('if [ "$(id -u)" != "0" ] && [ ! -w /data ]; then');
            expect(source).toContain("chown -R node:node /data");
            expect(source).toContain(
                "exec su-exec node:node env HOME=/home/node USER=node LOGNAME=node",
            );
            expect(source.indexOf("chown -R node:node /data")).toBeLessThan(
                source.indexOf("exec su-exec node:node"),
            );
        }
    });

    test.each(["docker-entrypoint.sh", "docker-entrypoint-hf.sh"])(
        "%s 在任何持久化文件操作前启用私有权限，并验证配置模式",
        async entrypoint => {
            const source = await readFile(resolve(repositoryRoot, entrypoint), "utf8");
            const privateUmask = source.indexOf("umask 077");
            const firstDataWrite = source.indexOf("mkdir -p /data");

            expect(privateUmask).toBeGreaterThanOrEqual(0);
            expect(firstDataWrite).toBeGreaterThan(privateUmask);
            expect(source).toContain("chmod 600 /data/config.yaml");
            expect(source).toContain("无法将");
            expect(source).toContain("配置权限收紧为 0600");
        },
    );
});
