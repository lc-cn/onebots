import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Docker 构建上下文", () => {
    test("标准镜像安装不执行原生终端下载脚本，PTY仅为可选能力并保留平台可选构建依赖", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        const metadata = JSON.parse(
            await readFile(resolve(repositoryRoot, "packages/onebots/package.json"), "utf8"),
        );
        expect(metadata.dependencies).not.toHaveProperty("@karinjs/node-pty");
        expect(metadata.optionalDependencies["@karinjs/node-pty"]).toMatch(/^\^?\d+\./);
        const installation = dockerfile
            .split(/\r?\n/)
            .find(line => line.startsWith("RUN pnpm install"));
        expect(installation).toContain("--ignore-scripts");
        expect(dockerfile).toContain("RUN pnpm prune --prod --ignore-scripts");
        // esbuild/Rollup/Tailwind platform binaries are distributed as optional packages.
        expect(installation).not.toMatch(/--no-optional|--omit[= ]optional/);
    });
    test("在构建后裁剪前冻结两个宿主工件，运行镜像只通过相对manifest定位", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        const pack = dockerfile.indexOf(
            "RUN node scripts/pack-control-runtime.mjs /app/runtime-artifacts",
        );
        expect(pack).toBeGreaterThan(dockerfile.indexOf("RUN pnpm build:packages"));
        expect(pack).toBeLessThan(dockerfile.indexOf("RUN pnpm prune --prod"));
        expect(dockerfile).toContain(
            "COPY scripts/pack-control-runtime.mjs ./scripts/pack-control-runtime.mjs",
        );
        expect(dockerfile).toContain(
            "COPY --chown=node:node --from=builder /app/runtime-artifacts ./runtime-artifacts",
        );
        expect(dockerfile).toContain(
            "ENV ONEBOTS_RUNTIME_ARTIFACTS=/app/runtime-artifacts/manifest.json",
        );
    });
    test("排除嵌套增量缓存和认证文件，防止缺失构建产物或泄露凭据", async () => {
        const patterns = (await readFile(resolve(repositoryRoot, ".dockerignore"), "utf8")).split(
            /\r?\n/,
        );
        for (const pattern of ["**/*.tsbuildinfo", ".npmrc", "**/.npmrc", "**/secrets"])
            expect(patterns).toContain(pattern);
    });
    test("在构建工作空间前复制子包继承的根 TypeScript 配置", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        const rootConfigCopy = dockerfile.indexOf(
            "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./",
        );
        const workspaceBuild = dockerfile.indexOf("RUN pnpm build:packages");

        expect(rootConfigCopy).toBeGreaterThanOrEqual(0);
        expect(workspaceBuild).toBeGreaterThan(rootConfigCopy);
    });

    test("运行镜像包含独立管理服务的健康检查", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");

        expect(dockerfile).toContain(
            "COPY --chown=node:node scripts/docker-healthcheck.mjs ./scripts/docker-healthcheck.mjs",
        );
        expect(dockerfile).toContain(
            "COPY --chown=node:node scripts/docker-extension-runtime.mjs scripts/docker-extension-release.mjs scripts/docker-extension-installer.mjs ./scripts/",
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
            expect(source).toContain("chown -R node:node /data");
            expect(source).toContain(
                "exec su-exec node:node env HOME=/home/node USER=node LOGNAME=node",
            );
            expect(source.indexOf("chown -R node:node /data")).toBeLessThan(
                source.indexOf("exec su-exec node:node"),
            );
            if (entrypoint.endsWith("-hf.sh")) {
                // HF 尚未切换管理宿主，原恢复流程的权限与受信扩展根约束继续保留。
                expect(source).toContain('if [ "$(id -u)" != "0" ] && [ ! -w /data ]; then');
                expect(source).toContain("node /app/scripts/docker-extension-runtime.mjs");
                expect(source).toContain("ONEBOTS_EXTENSION_ROOT 必须是绝对路径");
                expect(source).toContain('cd "$ONEBOTS_EXTENSION_ROOT"');
            } else {
                const nonRootWriteGuard = source.indexOf("if [ ! -w /data ]; then");
                const directExec = source.indexOf(
                    'exec node /app/packages/onebots/lib/bin.js "$@"',
                );
                expect(nonRootWriteGuard).toBeGreaterThan(source.indexOf("exec su-exec node:node"));
                expect(directExec).toBeGreaterThan(nonRootWriteGuard);
                expect(source).toContain("当前容器用户无法写入 /data");
                expect(source).toContain("if ! chown -R node:node /data; then");
            }
        }
    });

    test("标准 Docker 默认只启动管理服务，空卷不生成平台配置或等待宿主脚本", async () => {
        const source = await readFile(resolve(repositoryRoot, "docker-entrypoint.sh"), "utf8");
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        const command = dockerfile.split(/\r?\n/).find(line => line.startsWith("CMD "));

        expect(command).toBe('CMD ["serve", "--data-dir", "/data", "--host", "0.0.0.0"]');
        expect(dockerfile).toContain('ENTRYPOINT ["/docker-entrypoint.sh"]');
        expect(source).toContain('node /app/packages/onebots/lib/bin.js "$@"');
        expect(source).not.toContain("config.sample.yaml");
        expect(source).not.toContain("config.yaml");
        expect(source).not.toContain("docker-extension-runtime.mjs");
        expect(source).not.toContain("ONEBOTS_EXTENSION_ROOT");
        expect(source).not.toMatch(/\b(?:while|until|sleep)\b/);
        const runtimeCommands = source
            .replace(/\\\r?\n/g, " ")
            .split(/\r?\n/)
            .filter(line => line.includes("/onebots/lib/bin.js"))
            .join("\n");
        expect(runtimeCommands).not.toMatch(/(?:^|\s)-(?:r|p|t)\s/m);
        expect(source).not.toMatch(/--(?:register|protocol|application)(?:\s|=)/);
        // 网关生灭归管理服务；入口不自行加后台进程或重启循环。
        expect(source).not.toMatch(/(?:^|\s)(?:nohup|supervisord)\s|\s&\s*$/m);
    });

    test.each(["docker-entrypoint.sh", "docker-entrypoint-hf.sh"])(
        "%s 在任何持久化文件操作前启用私有权限，并验证配置模式",
        async entrypoint => {
            const source = await readFile(resolve(repositoryRoot, entrypoint), "utf8");
            const privateUmask = source.indexOf("umask 077");
            const firstDataWrite = source.indexOf("mkdir -p /data");

            expect(privateUmask).toBeGreaterThanOrEqual(0);
            expect(firstDataWrite).toBeGreaterThan(privateUmask);
            if (entrypoint.endsWith("-hf.sh"))
                expect(source).toContain("chmod 600 /data/config.yaml");
            else expect(source).not.toContain("config.sample.yaml");
            expect(source).toContain("无法将");
            if (entrypoint.endsWith("-hf.sh")) expect(source).toContain("配置权限收紧为 0600");
        },
    );

    test("HF 入口恢复轻量扩展清单并使用受信任恢复模式", async () => {
        const source = await readFile(resolve(repositoryRoot, "docker-entrypoint-hf.sh"), "utf8");
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile.hf"), "utf8");

        expect(source).toContain("extensions_backup.json");
        expect(source).toContain("/data/extensions/hf-restore.json");
        expect(source).toContain("hf-repository-download.mjs data_backup.tar.gz");
        expect(source).toContain("hf-repository-download.mjs config_backup.yaml");
        expect(source).toContain("hf-repository-download.mjs extensions_backup.json");
        expect(source).toContain("node /app/scripts/hf-data-archive-restore.mjs");
        expect(source).not.toContain("tar -xzf");
        expect(source).not.toContain("curl ");
        const clearStaleArchive = source.indexOf("rm -f /tmp/data_backup.tar.gz");
        const downloadArchive = source.indexOf("hf-repository-download.mjs data_backup.tar.gz");
        expect(clearStaleArchive).toBeGreaterThanOrEqual(0);
        expect(clearStaleArchive).toBeLessThan(downloadArchive);
        expect(source.indexOf("rm -f /tmp/data_backup.tar.gz", downloadArchive)).toBeGreaterThan(
            downloadArchive,
        );
        expect(source).toContain("docker-extension-runtime.mjs --restore");
        expect(source.indexOf("extensions_backup.json")).toBeLessThan(
            source.indexOf("docker-extension-runtime.mjs --restore"),
        );
        expect(dockerfile).toContain(
            "COPY --chown=node:node scripts/hf-repository-download.mjs /app/scripts/hf-repository-download.mjs",
        );
        expect(dockerfile).toContain(
            "COPY --chown=node:node scripts/hf-data-archive-restore.mjs /app/scripts/hf-data-archive-restore.mjs",
        );
        expect(dockerfile).not.toContain("apk add --no-cache curl");
    });
});
