import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalWorkspace } from "./workspace.js";
import { runTuiSession, pageChoices, type SessionPrompt } from "./session.js";
import { TuiCancelled } from "./prompt.js";
const directories: string[] = [];
afterEach(() => {
    for (const root of directories.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
describe("工作台导航", () => {
    it("切页不丢草稿，取消退出回到当前页，再明确放弃退出", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-nav-"));
        directories.push(root);
        const workspace = new TerminalWorkspace(path.join(root, "config.yaml"), root);
        workspace.update({ ...workspace.config, port: 7777 });
        for (const page of [
            "overview",
            "extensions",
            "accounts",
            "protocols",
            "frameworks",
            "service",
            "settings",
        ] as const) {
            const choices = pageChoices(page, workspace);
            expect(new Set(choices.map(choice => choice.value)).size).toBe(choices.length);
        }
        const answers: Array<string[] | Error> = [
            ["$page:settings"],
            ["$next"],
            ["quit"],
            new TuiCancelled(),
            new TuiCancelled(),
            ["yes"],
        ];
        const prompt: SessionPrompt = {
            report: vi.fn(),
            refresh: vi.fn(),
            section: vi.fn(),
            ask: vi.fn(async () => {
                expect(workspace.config.port).toBe(7777);
                const answer = answers.shift();
                if (answer instanceof Error) throw answer;
                if (!answer) throw new Error("unexpected prompt");
                return answer;
            }),
        };
        await runTuiSession(prompt, workspace);
        expect(vi.mocked(prompt.section).mock.calls.map(([page]) => page)).toEqual([
            "overview",
            "settings",
            "overview",
            "overview",
        ]);
        expect(fs.existsSync(workspace.configPath)).toBe(false);
    });
});
