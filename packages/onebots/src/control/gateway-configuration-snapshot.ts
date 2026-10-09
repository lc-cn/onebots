import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import yaml from "js-yaml";

/** 管理服务唯一写入：热应用与冷启动消费相同的去管理凭据、摘要绑定快照。 */
export function createGatewayConfigurationSnapshot(
    workspace: string,
    document: Record<string, unknown>,
): { configPath: string; configVersion: string } {
    const runtime = { ...document };
    delete runtime.username;
    delete runtime.password;
    delete runtime.access_token;
    const content = yaml.dump(runtime);
    const configVersion = createHash("sha256").update(content).digest("hex");
    const directory = path.join(fs.realpathSync(workspace), ".control", "configurations");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.realpathSync(directory) !== directory) throw new Error("网关快照目录无效");
    const configPath = path.join(directory, `${configVersion}.yaml`);
    if (!fs.existsSync(configPath))
        fs.writeFileSync(configPath, content, { flag: "wx", mode: 0o600 });
    const stat = fs.lstatSync(configPath);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        (process.platform !== "win32" && (stat.mode & 0o077) !== 0) ||
        createHash("sha256").update(fs.readFileSync(configPath)).digest("hex") !== configVersion
    )
        throw new Error("网关快照校验失败");
    return { configPath, configVersion };
}
