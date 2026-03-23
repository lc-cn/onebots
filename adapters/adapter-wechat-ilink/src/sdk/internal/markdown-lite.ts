/** 将常见 Markdown 压成纯文本 */
export function coercePlainMarkdown(source: string): string {
    const lines = source.split(/\r?\n/);
    const acc: string[] = [];
    for (const raw of lines) {
        let line = raw.trimEnd();
        if (/^```/.test(line)) continue;
        if (/^\s*```/.test(line)) continue;
        line = line.replace(/^#{1,6}\s+/, "");
        line = line.replace(/^\s*>\s?/, "");
        line = line.replace(/^\s*[-*+]\s+/, "");
        line = line.replace(/^\s*\d+\.\s+/, "");
        line = line.replace(/`([^`]+)`/g, "$1");
        line = line.replace(/!\[[^\]]*]\([^)]*\)/g, "");
        line = line.replace(/\[([^\]]+)]\([^)]*\)/g, "$1");
        line = line.replace(/[*_~]+/g, "");
        if (line.trim()) acc.push(line.trimEnd());
    }
    let flat = acc.join("\n").replace(/\|/g, " ");
    flat = flat.replace(/\s+/g, " ");
    return flat.trim();
}
