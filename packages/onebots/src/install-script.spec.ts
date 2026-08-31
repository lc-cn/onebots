import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function writeExecutable(file: string, content: string): void {
    fs.writeFileSync(file, content, { encoding: "utf8", mode: 0o755 });
}

function createFakeRuntime() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-installer-"));
    temporaryDirectories.push(home);
    const bin = path.join(home, "fake-bin");
    const log = path.join(home, "commands.log");
    const serviceMarker = path.join(home, "service-running");
    const onebotsSource = path.join(home, "fake-onebots");
    fs.mkdirSync(bin, { recursive: true });

    writeExecutable(
        path.join(bin, "node"),
        `#!/bin/sh
if [ "$1" = "-p" ]; then printf '24\\n'; exit 0; fi
exit 2
`,
    );
    writeExecutable(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
    writeExecutable(
        onebotsSource,
        `#!/bin/sh
printf 'onebots %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
command_name=$1
shift
case "$command_name" in
    setup)
        config_file=""
        while [ "$#" -gt 0 ]; do
            if [ "$1" = "-c" ]; then config_file=$2; shift 2; else shift; fi
        done
        mkdir -p "$(dirname "$config_file")"
        cat > "$config_file" <<'EOF'
access_token: first-token
port: 6727
plugins:
  adapters: []
  protocols: [onebot-v11]
general: {}
EOF
        ;;
    install) ;;
    restart)
        [ -f "$FAKE_SERVICE_MARKER" ] || exit 1
        ;;
    start)
        : > "$FAKE_SERVICE_MARKER"
        ;;
    status)
        [ -f "$FAKE_SERVICE_MARKER" ] || exit 1
        [ "\${FAKE_STATUS_FAIL:-0}" = "1" ] && exit 3
        printf '运行中，已就绪\\n'
        ;;
    *) exit 2 ;;
esac
`,
    );
    writeExecutable(
        path.join(bin, "npm"),
        `#!/bin/sh
printf 'npm %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
[ "\${FAKE_NPM_FAIL:-0}" = "1" ] && exit 42
mkdir -p node_modules/.bin
cp "$FAKE_ONEBOTS_SOURCE" node_modules/.bin/onebots
chmod 755 node_modules/.bin/onebots
`,
    );
    return { home, bin, log, serviceMarker, onebotsSource };
}

function runInstaller(
    runtime: ReturnType<typeof createFakeRuntime>,
    extraEnvironment: Record<string, string> = {},
): string {
    return execFileSync("/bin/sh", [path.join(repositoryRoot, "install.sh")], {
        encoding: "utf8",
        env: {
            ...process.env,
            HOME: runtime.home,
            ONEBOTS_HOME: path.join(runtime.home, ".onebots"),
            PATH: `${runtime.bin}:${process.env.PATH ?? ""}`,
            FAKE_COMMAND_LOG: runtime.log,
            FAKE_SERVICE_MARKER: runtime.serviceMarker,
            FAKE_ONEBOTS_SOURCE: runtime.onebotsSource,
            ...extraEnvironment,
        },
    });
}

describe("one-command installer", () => {
    it("重复执行 POSIX 安装脚本时保留配置并切换运行服务", () => {
        const runtime = createFakeRuntime();
        const configPath = path.join(runtime.home, ".onebots", "config.yaml");

        runInstaller(runtime);

        const firstCommands = fs.readFileSync(runtime.log, "utf8");
        expect(firstCommands).toContain("onebots setup -c");
        expect(firstCommands).not.toContain("setup --force");
        expect(firstCommands).toContain("onebots install -c");
        expect(firstCommands).toContain("onebots restart");
        expect(firstCommands).toContain("onebots start");
        expect(firstCommands).toContain("onebots status");

        const customized = `access_token: preserved-token
port: 7788
plugins:
  adapters: [slack]
  protocols: [milky-v1]
slack.production:
  token: preserved-secret
`;
        fs.writeFileSync(configPath, customized, "utf8");
        fs.writeFileSync(runtime.log, "", "utf8");

        const output = runInstaller(runtime);

        expect(fs.readFileSync(configPath, "utf8")).toBe(customized);
        expect(output).toContain("检测到已有配置，保留账号、凭据和插件选择");
        const secondCommands = fs.readFileSync(runtime.log, "utf8");
        expect(secondCommands).not.toContain("onebots setup");
        expect(secondCommands).toContain("onebots install -c");
        expect(secondCommands).toContain("onebots restart");
        expect(secondCommands).not.toContain("onebots start");
        expect(secondCommands).toContain("onebots status");
    });

    it("PowerShell 安装脚本显式闭合原生命令失败并保留已有配置", () => {
        const source = fs.readFileSync(path.join(repositoryRoot, "install.ps1"), "utf8");

        expect(source).toContain("function Invoke-Checked");
        expect(source).toContain("if ($LASTEXITCODE -ne 0)");
        expect(source).toContain("if (-not $ConfigExists)");
        expect(source).not.toContain("setup --force");
        expect(source).toContain("& $OneBots restart");
        expect(source).toContain('Invoke-Checked -FilePath $OneBots -Arguments @("start")');
        expect(source).toContain("function Wait-OneBotsReady");
        expect(source).toContain("Wait-OneBotsReady -OneBotsCommand $OneBots");
    });

    it("在线状态始终失败时不会宣告安装完成", () => {
        const runtime = createFakeRuntime();
        let output = "";

        try {
            runInstaller(runtime, { FAKE_STATUS_FAIL: "1" });
        } catch (error) {
            output = String((error as { stdout?: string }).stdout ?? "");
        }

        expect(output).not.toContain("安装完成");
        const commands = fs.readFileSync(runtime.log, "utf8");
        expect(commands.match(/onebots status/g)).toHaveLength(15);
    });

    it("npm 失败时立即停止且不创建配置或安装服务", () => {
        const runtime = createFakeRuntime();
        const configPath = path.join(runtime.home, ".onebots", "config.yaml");

        expect(() => runInstaller(runtime, { FAKE_NPM_FAIL: "1" })).toThrow();

        expect(fs.existsSync(configPath)).toBe(false);
        const commands = fs.readFileSync(runtime.log, "utf8");
        expect(commands).toContain("npm install --omit=dev");
        expect(commands).not.toContain("onebots setup");
        expect(commands).not.toContain("onebots install");
    });
});
