import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Docker 构建上下文", () => {
    test("在构建工作空间前复制子包继承的根 TypeScript 配置", async () => {
        const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
        const rootConfigCopy = dockerfile.indexOf(
            "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./",
        );
        const workspaceBuild = dockerfile.indexOf("RUN pnpm build:packages");

        expect(rootConfigCopy).toBeGreaterThanOrEqual(0);
        expect(workspaceBuild).toBeGreaterThan(rootConfigCopy);
    });
});
