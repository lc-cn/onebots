import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const docsRoot = join(repositoryRoot, "docs/src");
const markdownRoots = [
    docsRoot,
    join(repositoryRoot, "packages/imhelper"),
    join(repositoryRoot, "protocols/milky-v1/protocol"),
    ...["milky-v1", "onebot-v11", "onebot-v12", "satori-v1"].map(protocol =>
        join(repositoryRoot, "protocols", protocol, "sdk"),
    ),
];

interface MarkdownDocument {
    path: string;
    content: string;
}

async function readMarkdownDocuments(directory: string): Promise<MarkdownDocument[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const documents = await Promise.all(
        entries.map(async entry => {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) return readMarkdownDocuments(path);
            if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "CHANGELOG.md") {
                return [];
            }
            return [
                { path: relative(repositoryRoot, path), content: await readFile(path, "utf8") },
            ];
        }),
    );
    return documents.flat();
}

const forbiddenContracts = [
    {
        description: "removed empty ImHelper constructor",
        pattern: /new ImHelper\(\s*\)/,
    },
    {
        description: "removed configuration-object ImHelper constructor",
        pattern: /new ImHelper\(\s*\{/,
    },
    {
        description: "removed client-side adapter registration",
        pattern: /client\.registerAdapter\(/,
    },
    {
        description: "adapter lifecycle bypass",
        pattern: /await adapter\.connect\(/,
    },
    {
        description: "obsolete SDK package name",
        pattern: /from ['"]@onebots\/imhelper['"]/,
    },
    {
        description: "Milky action outside the API namespace",
        pattern: /milky\/v1\/\{action\}/,
    },
    {
        description: "legacy synthetic Milky send endpoint",
        pattern: /milky\/v1\/send(?=[\s`'"])/,
    },
    {
        description: "Milky WebSocket endpoint without event suffix",
        pattern: /ws:\/\/[^\s`'"]+\/milky\/v1(?=[\s`'"])/,
    },
    {
        description: "Satori documented as an action protocol",
        pattern: /satori\/v1\/\{action\}/,
    },
] as const;

describe("client SDK documentation contracts", () => {
    it.each(forbiddenContracts)("不再出现 $description", async ({ pattern }) => {
        const documents = (
            await Promise.all(markdownRoots.map(root => readMarkdownDocuments(root)))
        ).flat();
        const violations = documents.filter(document => pattern.test(document.content));
        expect(violations.map(document => document.path)).toEqual([]);
    });

    it.each(["guide/client-sdk.md", "en/guide/client-sdk.md"])(
        "%s 覆盖具体 Client 与所有接收模式",
        async path => {
            const content = await readFile(join(docsRoot, path), "utf8");
            for (const factory of [
                "createOnebot11Client",
                "createOnebot12Client",
                "createMilkyClient",
                "createSatoriClient",
            ]) {
                expect(content).toContain(factory);
            }
            for (const mode of ["ws", "sse", "wss", "webhook", "manual"]) {
                expect(content).toMatch(new RegExp(`\\b${mode}\\b`));
            }
            expect(content).toContain("acceptHttp");
            expect(content).toContain("acceptWebSocket");
            expect(content).toContain("ingest");
        },
    );

    it.each(["protocol/milky.md", "en/protocol/milky.md"])(
        "%s 使用 canonical Milky 事件和动作契约",
        async path => {
            const content = await readFile(join(docsRoot, path), "utf8");
            expect(content).toContain("message_receive");
            expect(content).toContain("message_scene");
            expect(content).toContain("/api/{action}");
            expect(content).toContain("/milky/v1/event");
            expect(content).not.toContain("post_message_format");
        },
    );
});
