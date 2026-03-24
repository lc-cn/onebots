export function withTrailingSlash(base: string): string {
    return base.endsWith("/") ? base : `${base}/`;
}
