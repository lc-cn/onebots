import { expect, it } from "vitest";
import { nativeHelperEnvironment } from "./native-helper-environment.js";
it("过滤原生子进程副本的配对秘密，保留父进程待消费状态", () => {
    const parent = {
        ONEBOTS_BOOTSTRAP_CODE: "synthetic-bootstrap",
        ONEBOTS_RECOVERY_CODE: "synthetic-recovery",
        NODE_ENV: "test",
    };
    const child = nativeHelperEnvironment(parent);
    expect(child).toEqual({ NODE_ENV: "test" });
    expect(parent.ONEBOTS_BOOTSTRAP_CODE).toBe("synthetic-bootstrap");
    expect(parent.ONEBOTS_RECOVERY_CODE).toBe("synthetic-recovery");
});
