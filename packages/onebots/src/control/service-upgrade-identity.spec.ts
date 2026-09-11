import { beforeEach, expect, it, vi } from "vitest";
import { createManagerUpgradeIdentity } from "./service-upgrade-release.js";
import {
    managerCandidateDigest,
    readRunningManagerCandidate,
} from "../manager-runtime/identity.js";
vi.mock("../manager-runtime/identity.js", () => ({
    readRunningManagerCandidate: vi.fn(),
    managerCandidateDigest: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
it("每次查询从可信模块重核当前候选", () => {
    vi.mocked(managerCandidateDigest).mockReturnValue("a".repeat(64));
    const identity = createManagerUpgradeIdentity("instance", "file:///trusted/host.js");
    expect(identity()).toEqual({ managerId: "instance", candidateDigest: "a".repeat(64) });
    expect(identity()).toEqual({ managerId: "instance", candidateDigest: "a".repeat(64) });
    expect(readRunningManagerCandidate).toHaveBeenCalledTimes(3);
    expect(readRunningManagerCandidate).toHaveBeenLastCalledWith("file:///trusted/host.js");
});
it("候选启动后被替换或损坏时返回空身份", () => {
    vi.mocked(managerCandidateDigest)
        .mockReturnValueOnce("a".repeat(64))
        .mockReturnValue("b".repeat(64));
    const identity = createManagerUpgradeIdentity("instance", "file:///trusted/host.js");
    expect(identity()).toEqual({ managerId: "instance", candidateDigest: null });
    vi.mocked(readRunningManagerCandidate).mockImplementation(() => {
        throw new Error("secret");
    });
    expect(identity()).toEqual({ managerId: "instance", candidateDigest: null });
});
it("普通安装启动时没有证明，后来补入收据也不能成为已启动候选", () => {
    vi.mocked(readRunningManagerCandidate).mockImplementationOnce(() => {
        throw new Error("absent");
    });
    const identity = createManagerUpgradeIdentity("instance", "file:///trusted/host.js");
    vi.mocked(managerCandidateDigest).mockReturnValue("a".repeat(64));
    expect(identity()).toEqual({ managerId: "instance", candidateDigest: null });
});
