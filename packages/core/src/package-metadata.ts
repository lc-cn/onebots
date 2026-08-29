import { readFile } from "node:fs/promises";
import { ValidationError } from "./errors.js";

/**
 * 读取调用方包根目录的版本号。
 *
 * 源码与编译产物都位于包内单层目录（src/lib），因此调用方只需传入
 * `import.meta.url`，无需各适配器重复实现 JSON 读取与类型校验。
 */
export async function readPackageVersion(moduleUrl: string | URL): Promise<string> {
    const packageUrl = new URL("../package.json", moduleUrl);
    let metadata: unknown;
    try {
        metadata = JSON.parse(await readFile(packageUrl, "utf8")) as unknown;
    } catch (error) {
        throw new ValidationError(`无法读取包元数据: ${packageUrl.pathname}`, { cause: error });
    }
    if (
        !metadata ||
        typeof metadata !== "object" ||
        !("version" in metadata) ||
        typeof metadata.version !== "string" ||
        !metadata.version.trim()
    ) {
        throw new ValidationError(`包元数据缺少有效 version: ${packageUrl.pathname}`);
    }
    return metadata.version;
}
