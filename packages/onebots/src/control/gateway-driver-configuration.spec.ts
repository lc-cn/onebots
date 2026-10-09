import { ChildProcess } from "node:child_process";
import { expect, it } from "vitest";
import { runtimeContext } from "./gateway-driver-configuration.js";

it("尚未收到 exit 事件也不发布已退出子进程的配置身份", () => {
    const child = new ChildProcess();
    child.connected = true;
    const managed = { child, stopping: false, exited: false, configurationVersion: "a".repeat(64) };
    expect(runtimeContext(managed, "gateway")).toEqual({
        gatewayInstanceId: "gateway",
        configVersion: managed.configurationVersion,
    });
    child.exitCode = 1;
    expect(runtimeContext(managed, "gateway")).toBeUndefined();
    child.exitCode = null;
    child.signalCode = "SIGTERM";
    expect(runtimeContext(managed, "gateway")).toBeUndefined();
});
