import type { CapabilityDescriptor, CommonTypes } from "@onebots/core";

/** 控制页的能力展示与实际发送必须使用同一场景判定。 */
export function supportsSendScene(
    capability: CapabilityDescriptor | undefined,
    scene: CommonTypes.Scene,
): boolean {
    return Boolean(
        capability &&
        capability.support !== "unsupported" &&
        (!capability.scenes || capability.scenes.includes(scene)),
    );
}
