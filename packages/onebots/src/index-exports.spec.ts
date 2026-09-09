import { expect, it } from "vitest";
import * as onebots from "./index.js";

it("公开入口不再暴露被管理安装链替代的旧安装 API", () => {
    expect(onebots.defineConfig).toBeTypeOf("function");
    for (const name of [
        "createInstallationPlan",
        "resolveInstallationPackages",
        "requiresInstallationCredential",
        "InstallationOperation",
        "createDockerRequestBackend",
        "readInstallationRequest",
        "writeInstallationRequest",
    ]) {
        expect(onebots).not.toHaveProperty(name);
    }
});
