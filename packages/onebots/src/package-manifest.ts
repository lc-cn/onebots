import * as fs from "node:fs";
import * as path from "node:path";

export type PackageManifest = Record<string, unknown>;

export type PackageManifestInspection =
    | { valid: true; manifest: PackageManifest; path: string }
    | { valid: false; error: string };

export const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;

/** 在解析前验证清单归属、文件类型与大小，避免特殊文件或超大依赖阻塞宿主。 */
export function inspectPackageManifest(file: string): PackageManifestInspection {
    let descriptor: number | undefined;
    try {
        const packageRoot = fs.realpathSync(path.dirname(file));
        const manifestPath = fs.realpathSync(file);
        if (path.dirname(manifestPath) !== packageRoot) {
            return { valid: false, error: `package.json 解析到实际包目录外: ${manifestPath}` };
        }
        if (!fs.statSync(manifestPath).isFile()) {
            return { valid: false, error: `package.json 不是常规文件: ${manifestPath}` };
        }
        descriptor = fs.openSync(manifestPath, "r");
        const stats = fs.fstatSync(descriptor);
        if (!stats.isFile()) {
            return { valid: false, error: `package.json 不是常规文件: ${manifestPath}` };
        }
        if (stats.size > MAX_PACKAGE_MANIFEST_BYTES) {
            return {
                valid: false,
                error: `package.json 超过 ${MAX_PACKAGE_MANIFEST_BYTES} 字节上限: ${manifestPath}`,
            };
        }
        const chunks: Buffer[] = [];
        let length = 0;
        while (length <= MAX_PACKAGE_MANIFEST_BYTES) {
            const chunk = Buffer.allocUnsafe(
                Math.min(64 * 1024, MAX_PACKAGE_MANIFEST_BYTES + 1 - length),
            );
            const bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, length);
            if (bytesRead === 0) break;
            chunks.push(chunk.subarray(0, bytesRead));
            length += bytesRead;
        }
        if (length > MAX_PACKAGE_MANIFEST_BYTES) {
            return {
                valid: false,
                error: `package.json 超过 ${MAX_PACKAGE_MANIFEST_BYTES} 字节上限: ${manifestPath}`,
            };
        }
        const parsed: unknown = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { valid: false, error: `package.json 根节点不是对象: ${manifestPath}` };
        }
        return { valid: true, manifest: parsed as PackageManifest, path: manifestPath };
    } catch {
        return { valid: false, error: `package.json 无法读取或不是有效 JSON: ${file}` };
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
}
