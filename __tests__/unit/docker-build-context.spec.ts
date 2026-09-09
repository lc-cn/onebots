import { readFile } from "node:fs/promises";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Docker 构建上下文", () => {
    test("标准镜像不再安装旧终端原生依赖，同时保留平台可选构建依赖", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        const metadata = JSON.parse(
            await readFile(resolve(repositoryRoot, "packages/onebots/package.json"), "utf8"),
        );
        expect(metadata.dependencies).not.toHaveProperty("@karinjs/node-pty");
        expect(metadata.optionalDependencies ?? {}).not.toHaveProperty("@karinjs/node-pty");
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
        expect(dockerfile).not.toContain("docker-extension-");
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
                // HF 与标准镜像使用同一管理宿主，恢复过程不执行历史扩展。
                expect(source).toContain('if [ "$(id -u)" != "0" ] && [ ! -w /data ]; then');
                expect(source).not.toContain("node /app/scripts/docker-extension-runtime.mjs");
                expect(source).toContain(
                    "unset HF_TOKEN ONEBOTS_EXTENSION_ROOT ONEBOTS_EXTENSION_MODE NODE_PATH",
                );
                expect(source).toContain("cd /app/development");
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
            expect(source).not.toContain("config.sample.yaml");
            expect(source).toContain("无法将");
        },
    );

    test("HF只恢复可移植数据，不修改网络或执行旧扩展", async () => {
        const source = await readFile(resolve(repositoryRoot, "docker-entrypoint-hf.sh"), "utf8");
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile.hf"), "utf8");
        expect(dockerfile).toContain('CMD ["serve", "--data-dir", "/data", "--host", "0.0.0.0"]');
        expect(source).not.toMatch(
            /docker-extension-runtime|extensions_backup|hf-restore\.json|tar -xzf|curl /,
        );
        expect(source).not.toMatch(/resolv\.conf|config\.sample|sed .*config|echo .*port.*config/);
        expect(source).toContain("hf-repository-download.mjs data_backup.tar.gz");
        expect(source).toContain("hf-repository-download.mjs config_backup.yaml");
        expect(source).toContain("node /app/scripts/hf-data-archive-restore.mjs");
        expect(source.indexOf("unset HF_TOKEN")).toBeLessThan(source.indexOf("exec su-exec"));
        expect(dockerfile).not.toContain("ONEBOTS_EXTENSION_MODE=legacy");
        const base = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        expect(base).not.toMatch(/mkdir[^\n]*\/data\/static/);
    });
});

// 仅替换容器绝对挂载路径；实际 /bin/sh 分支执行，node/uid 使用受控替身。
describe("HF入口恢复分支", () => {
    test.each(["blank", "existing", "interrupted", "config-interrupted", "restore-failed"])(
        "%s 卷不会执行未知恢复或历史依赖",
        async scenario => {
            const root = fs.mkdtempSync(resolve(tmpdir(), "hf-entry-test-"));
            try {
                const volume = resolve(root, "volume");
                const app = resolve(root, "app");
                const bin = resolve(root, "bin");
                fs.mkdirSync(volume);
                fs.mkdirSync(resolve(app, "development"), { recursive: true });
                fs.mkdirSync(bin);
                const calls = resolve(root, "calls");
                const config = resolve(volume, "config.yaml");
                if (scenario === "existing") fs.writeFileSync(config, "synthetic-secret: [\r\n");
                if (scenario === "interrupted")
                    fs.mkdirSync(resolve(volume, ".hf-restore-interrupted"));
                if (scenario === "config-interrupted")
                    fs.writeFileSync(
                        resolve(volume, "config.yaml.123.fixture.tmp"),
                        "partial-private-config",
                    );
                fs.writeFileSync(resolve(bin, "id"), "#!/bin/sh\necho 1000\n", { mode: 0o700 });
                fs.writeFileSync(
                    resolve(bin, "node"),
                    `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1" in
  *hf-repository-download.mjs) [ "$SCENARIO" = restore-failed ]; exit $? ;;
  *hf-data-archive-restore.mjs) exit 1 ;;
  *lib/bin.js) [ -z "\${HF_TOKEN:-}\${ONEBOTS_EXTENSION_ROOT:-}\${NODE_PATH:-}" ] || exit 9; exit 0 ;;
  *) exit 10 ;;
esac
`,
                    { mode: 0o700 },
                );
                const source = (
                    await readFile(resolve(repositoryRoot, "docker-entrypoint-hf.sh"), "utf8")
                )
                    .replaceAll("/tmp/data_backup.tar.gz", resolve(root, "backup.tar.gz"))
                    .replaceAll("/data", volume)
                    .replaceAll("/app", app);
                const script = resolve(root, "entry.sh");
                fs.writeFileSync(script, source);
                let failed = false;
                try {
                    execFileSync("/bin/sh", [script], {
                        env: {
                            ...process.env,
                            PATH: `${bin}:${process.env.PATH}`,
                            SCENARIO: scenario,
                            CALL_LOG: calls,
                            HF_REPO_ID: "test/repo",
                            HF_TOKEN: "synthetic",
                            ONEBOTS_EXTENSION_ROOT: "/legacy",
                            NODE_PATH: "/legacy",
                        },
                        stdio: "pipe",
                        timeout: 5000,
                    });
                } catch {
                    failed = true;
                }
                const log = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "";
                expect(failed).toBe(
                    ["interrupted", "config-interrupted", "restore-failed"].includes(scenario),
                );
                if (["interrupted", "config-interrupted"].includes(scenario)) expect(log).toBe("");
                if (scenario === "config-interrupted") {
                    expect(
                        fs.readFileSync(resolve(volume, "config.yaml.123.fixture.tmp"), "utf8"),
                    ).toBe("partial-private-config");
                    expect(fs.existsSync(config)).toBe(false);
                }
                if (scenario === "existing") {
                    expect(log).not.toContain("hf-repository-download");
                    expect(fs.readFileSync(config, "utf8")).toBe("synthetic-secret: [\r\n");
                }
                if (scenario === "blank") {
                    expect(log).toContain("data_backup.tar.gz");
                    expect(log).toContain("config_backup.yaml");
                }
                if (scenario === "restore-failed") {
                    expect(log).toContain("hf-data-archive-restore");
                    expect(log).not.toContain("config_backup.yaml");
                    expect(log).not.toContain("lib/bin.js");
                } else if (!["interrupted", "config-interrupted"].includes(scenario))
                    expect(log).toContain(`lib/bin.js serve --data-dir ${volume} --host 0.0.0.0`);
                expect(log).not.toContain("docker-extension");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    );
});
