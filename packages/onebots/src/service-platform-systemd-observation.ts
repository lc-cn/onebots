/** 同实例自然状态变迁使复合观测失效；只能重读，不能复用先前的内核证据。 */
export class SystemdObservationChanged extends Error {}

export function isNaturalSystemdTransition(
    before: Readonly<Record<string, string>>,
    after: Readonly<Record<string, string>>,
): boolean {
    const stableBinding = ["LoadState", "FragmentPath", "UnitFileState"].every(
        key => before[key] === after[key],
    );
    const stopped =
        ((after.ActiveState === "inactive" && after.SubState === "dead") ||
            (after.ActiveState === "failed" && after.SubState === "failed")) &&
        after.MainPID === "0" &&
        after.ControlPID === "0";
    const sameIdentity =
        before.InvocationID === after.InvocationID || (stopped && after.InvocationID === "");
    const sameGroup =
        before.ControlGroup === after.ControlGroup || (stopped && after.ControlGroup === "");
    return stableBinding && sameIdentity && sameGroup;
}
