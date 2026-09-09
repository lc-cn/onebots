import type { GenerationPlan } from "./generation-plan.js";

async function verifyGeneration(directory: string, plan: GenerationPlan): Promise<string> {
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const { verifyGenerationRuntime } = await import(
        new URL(`./generation-verification-runtime.${extension}`, import.meta.url).href
    );
    return verifyGenerationRuntime(directory, plan);
}

if (!process.send || !process.connected) process.exit(1);
process.once("message", async (value: { directory: string; plan: GenerationPlan }) => {
    try {
        const schemas = await verifyGeneration(value.directory, value.plan);
        process.send?.({ schemas }, () => process.exit(0));
    } catch {
        // 不输出第三方异常、包管理器内容或继承控制面凭据。
        process.send?.({ failed: true }, () => process.exit(1));
    }
});
function stopDetachedVerification(): void {
    // The parent forks this private worker as its own POSIX group leader.
    if (process.platform !== "win32" && process.env.ONEBOTS_VERIFY_PROCESS_GROUP === "1") {
        try {
            process.kill(-process.pid, "SIGKILL");
        } catch {
            /* If the group is already absent, exit this worker normally. */
        }
    }
    process.exit(1);
}
process.once("disconnect", stopDetachedVerification);
process.once("SIGTERM", stopDetachedVerification);
