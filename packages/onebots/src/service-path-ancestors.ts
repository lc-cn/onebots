import path from "node:path";

/** 从卷根之后枚举绝对路径，避免把 Windows drive 或 UNC share 再拼回根路径。 */
export function serviceAncestorPaths(
    directory: string,
    platform: NodeJS.Platform = process.platform,
): string[] {
    const paths = platform === "win32" ? path.win32 : path.posix;
    const root = paths.parse(directory).root;
    const relative = paths.relative(root, directory);
    let current = root;
    return relative
        .split(paths.sep)
        .filter(Boolean)
        .map(part => (current = paths.join(current, part)));
}
