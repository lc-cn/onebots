import { readFile } from "node:fs/promises";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const managerCommand =
    'CMD ["serve", "--data-dir", "/data", "--authority-dir", "/var/lib/onebots-authority/authority", "--host", "0.0.0.0"]';

describe("Docker 构建上下文", () => {
    test("标准镜像把本地终端保持为可降级能力，同时保留平台可选构建依赖", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        const metadata = JSON.parse(
            await readFile(resolve(repositoryRoot, "packages/onebots/package.json"), "utf8"),
        );
        expect(metadata.dependencies).not.toHaveProperty("@karinjs/node-pty");
        expect(metadata.optionalDependencies ?? {}).toHaveProperty("@karinjs/node-pty");
        const installation = dockerfile
            .split(/\r?\n/)
            .find(line => line.startsWith("RUN pnpm install"));
        expect(installation).toContain("--ignore-scripts");
        expect(dockerfile).toContain("RUN CI=true pnpm install --prod --offline --ignore-scripts");
        // esbuild/Rollup/Tailwind platform binaries are distributed as optional packages.
        expect(installation).not.toMatch(/--no-optional|--omit[= ]optional/);
    });
    test("在构建后裁剪前冻结两个宿主工件，运行镜像只通过相对manifest定位", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        const pack = dockerfile.indexOf(
            "RUN node scripts/pack-control-runtime.mjs /app/runtime-artifacts",
        );
        expect(pack).toBeGreaterThan(dockerfile.indexOf("RUN pnpm build:packages"));
        expect(pack).toBeLessThan(dockerfile.indexOf("RUN CI=true pnpm install --prod --offline"));
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

    test("在构建工作空间前复制各包共用的清理脚本", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        const helperCopy = dockerfile.indexOf(
            "COPY scripts/clean-package.mjs ./scripts/clean-package.mjs",
        );
        const workspaceBuild = dockerfile.indexOf("RUN pnpm build:packages");

        expect(helperCopy).toBeGreaterThanOrEqual(0);
        expect(helperCopy).toBeLessThan(workspaceBuild);
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
            expect(source).toContain(". /app/docker-workspace.sh");
            expect(source).toContain(". /app/docker-authority.sh");
            expect(source).not.toContain("chown -R");
            expect(source).toContain(
                "exec su-exec node:node env HOME=/home/node USER=node LOGNAME=node",
            );
            expect(source.indexOf(". /app/docker-workspace.sh")).toBeLessThan(
                source.indexOf("exec su-exec node:node"),
            );
            if (entrypoint.endsWith("-hf.sh")) {
                expect(source).not.toContain("node /app/scripts/docker-extension-runtime.mjs");
                expect(source).toContain(
                    "unset HF_TOKEN ONEBOTS_EXTENSION_ROOT ONEBOTS_EXTENSION_MODE NODE_PATH",
                );
                expect(source).toContain("cd /app/development");
            }
        }
        const workspace = await readFile(resolve(repositoryRoot, "docker-workspace.sh"), "utf8");
        expect(workspace).not.toContain("chown -R");
        expect(workspace).toContain('[ "$(id -u)" = "0" ] && [ -z "$DATA_CONTENT" ]');
        expect(workspace).toContain("chown node:node /data");
        expect(workspace).toContain(
            "run_workspace_user sh -c '[ -r /data ] && [ -w /data ] && [ -x /data ]'",
        );
        expect(workspace).toContain("既有目录未自动修改");
    });

    test("标准 Docker 默认只启动管理服务，空卷不生成平台配置或等待宿主脚本", async () => {
        const source = await readFile(resolve(repositoryRoot, "docker-entrypoint.sh"), "utf8");
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        const command = dockerfile.split(/\r?\n/).find(line => line.startsWith("CMD "));

        expect(command).toBe(managerCommand);
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
        "%s 在准备持久目录前启用私有权限，不生成业务配置",
        async entrypoint => {
            const source = await readFile(resolve(repositoryRoot, entrypoint), "utf8");
            const privateUmask = source.indexOf("umask 077");
            const firstDataWrite = source.indexOf(". /app/docker-workspace.sh");

            expect(privateUmask).toBeGreaterThanOrEqual(0);
            expect(firstDataWrite).toBeGreaterThan(privateUmask);
            expect(source).not.toContain("config.sample.yaml");
            expect(source.indexOf(". /app/docker-authority.sh")).toBeGreaterThan(firstDataWrite);
        },
    );

    test("HF明确禁用自动恢复，不修改网络或执行旧扩展，保留独立归档工具", async () => {
        const source = await readFile(resolve(repositoryRoot, "docker-entrypoint-hf.sh"), "utf8");
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile.hf"), "utf8");
        expect(dockerfile).toContain(managerCommand);
        expect(source).not.toMatch(
            /docker-extension-runtime|extensions_backup|hf-restore\.json|tar -xzf|curl /,
        );
        expect(source).not.toMatch(/resolv\.conf|config\.sample|sed .*config|echo .*port.*config/);
        expect(source).not.toMatch(/hf-repository-download|hf-data-archive-restore/);
        const restoreGuard = source.indexOf('if [ -n "${HF_REPO_ID:-}" ]; then');
        expect(restoreGuard).toBeGreaterThan(source.indexOf("umask 077"));
        expect(restoreGuard).toBeLessThan(source.indexOf(". /app/docker-workspace.sh"));
        expect(source).toContain("首期禁用 HF_REPO_ID 自动恢复");
        expect(dockerfile).toContain("COPY --chown=node:node scripts/hf-data-archive-restore.mjs");
        expect(dockerfile).toContain("COPY --chown=node:node scripts/hf-repository-download.mjs");
        expect(source.indexOf("unset HF_TOKEN")).toBeLessThan(source.indexOf("exec su-exec"));
        expect(dockerfile).not.toContain("ONEBOTS_EXTENSION_MODE=legacy");
        const base = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        expect(base).not.toMatch(/mkdir[^\n]*\/data\/static/);
    });
});

// 执行真实 /bin/sh 入口；目录准备 helper 与 node/uid 用记录调用的替身。
// helper 自身的权限与文件保留由真实容器元数据验收覆盖。
describe("HF入口恢复边界", () => {
    const scenarios = ["blank", "existing", "interrupted", "config-interrupted"];
    test.each(
        scenarios.flatMap(scenario => [
            { scenario, automaticRestore: false },
            { scenario, automaticRestore: true },
        ]),
    )(
        "$scenario 卷，HF_REPO_ID 自动恢复=$automaticRestore",
        async ({ scenario, automaticRestore }) => {
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
                fs.chmodSync(volume, 0o700);
                if (scenario === "existing") fs.writeFileSync(config, "synthetic-secret: [\r\n");
                if (scenario === "interrupted")
                    fs.mkdirSync(resolve(volume, ".hf-restore-interrupted"));
                if (scenario === "config-interrupted")
                    fs.writeFileSync(
                        resolve(volume, "config.yaml.123.fixture.tmp"),
                        "partial-private-config",
                    );
                const snapshot = () =>
                    [
                        volume,
                        ...fs
                            .readdirSync(volume)
                            .sort()
                            .map(name => resolve(volume, name)),
                    ].map(path => {
                        const stat = fs.lstatSync(path);
                        return {
                            path,
                            mode: stat.mode,
                            uid: stat.uid,
                            gid: stat.gid,
                            ctimeMs: stat.ctimeMs,
                            bytes: stat.isFile() ? fs.readFileSync(path).toString("hex") : null,
                        };
                    });
                const before = snapshot();
                for (const helper of ["docker-workspace.sh", "docker-authority.sh"])
                    fs.writeFileSync(
                        resolve(app, helper),
                        `printf '%s\\n' '${helper}' >> "$CALL_LOG"\n`,
                    );
                fs.writeFileSync(resolve(bin, "id"), "#!/bin/sh\necho 1000\n", { mode: 0o700 });
                fs.writeFileSync(
                    resolve(bin, "node"),
                    `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1" in
  *lib/bin.js) [ -z "\${HF_TOKEN:-}\${ONEBOTS_EXTENSION_ROOT:-}\${NODE_PATH:-}" ] || exit 9; exit 0 ;;
  *) exit 10 ;;
esac
`,
                    { mode: 0o700 },
                );
                const source = (
                    await readFile(resolve(repositoryRoot, "docker-entrypoint-hf.sh"), "utf8")
                )
                    .replaceAll("/data", volume)
                    .replaceAll("/app", app);
                const script = resolve(root, "entry.sh");
                fs.writeFileSync(script, source);
                const result = spawnSync("/bin/sh", [script], {
                    env: {
                        ...process.env,
                        PATH: `${bin}:${process.env.PATH}`,
                        SCENARIO: scenario,
                        CALL_LOG: calls,
                        HF_REPO_ID: automaticRestore ? "test/repo" : "",
                        HF_TOKEN: "synthetic",
                        ONEBOTS_EXTENSION_ROOT: "/legacy",
                        NODE_PATH: "/legacy",
                    },
                    stdio: "pipe",
                    encoding: "utf8",
                    timeout: 5000,
                });
                expect(result.error).toBeUndefined();
                const log = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "";
                expect(snapshot()).toEqual(before);
                if (automaticRestore) {
                    expect(result.status).toBe(1);
                    expect(result.stdout).toContain("首期禁用 HF_REPO_ID 自动恢复");
                    // 在任何 helper、下载器或管理进程执行前明确拒绝。
                    expect(log).toBe("");
                } else if (["interrupted", "config-interrupted"].includes(scenario)) {
                    expect(result.status).toBe(1);
                    expect(result.stdout).toContain("存在未完成的 HF 恢复");
                    expect(log).not.toContain("lib/bin.js");
                } else {
                    expect(result.status).toBe(0);
                    expect(log).toContain(
                        `lib/bin.js serve --data-dir ${volume} --authority-dir /var/lib/onebots-authority/authority --host 0.0.0.0`,
                    );
                }
                if (!automaticRestore) {
                    expect(log).toContain("docker-workspace.sh");
                    expect(log).toContain("docker-authority.sh");
                }
                expect(log).not.toMatch(/hf-repository-download|hf-data-archive-restore/);
                expect(log).not.toContain("docker-extension");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    );
});
