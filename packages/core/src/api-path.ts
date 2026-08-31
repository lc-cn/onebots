/** 判断 API path 是否为不携带 query/fragment/路径穿越的绝对路径。 */
export function isSafeAbsoluteApiPath(path: string): boolean {
    if (
        !path.startsWith("/") ||
        path.startsWith("//") ||
        path.includes("?") ||
        path.includes("#") ||
        path.includes("\\") ||
        /[\u0000-\u001f\u007f]/u.test(path)
    ) {
        return false;
    }
    try {
        return path
            .slice(1)
            .split("/")
            .every(segment => {
                const decoded = decodeURIComponent(segment);
                return (
                    decoded.length > 0 &&
                    decoded !== "." &&
                    decoded !== ".." &&
                    !/[/?#\\\u0000-\u001f\u007f]/u.test(decoded)
                );
            });
    } catch {
        return false;
    }
}
