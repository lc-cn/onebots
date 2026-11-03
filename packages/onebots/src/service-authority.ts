import path from "node:path";
import { getServiceFiles } from "./service-files.js";
import type { ServiceScope } from "./service-definition.js";
import type { ServiceHost } from "./service-host.js";
import {
    parseManagerServiceSpec,
    type ManagerServiceSpec,
    type ManagerServiceSpecV2,
} from "./manager-service-spec.js";

/** 仅可信 CLI 在构造新契约时解析；历史 spec 和工作区绑定不得参与路径推断。 */
export function defaultServiceAuthorityDirectory(
    scope: ServiceScope,
    host: Pick<ServiceHost, "platform" | "homedir" | "env">,
): string {
    return path.join(getServiceFiles(scope, host).stateDir, "authority");
}

/** 显式升级事务可把历史契约提升到 v2；已登记部署的来源不随程序升级改变。 */
export function upgradeServiceAuthority(
    spec: ManagerServiceSpec,
    host: ServiceHost,
    authorityDirectory?: string,
): ManagerServiceSpecV2 {
    const authority =
        authorityDirectory ??
        (spec.schemaVersion === 2
            ? spec.authorityDirectory
            : defaultServiceAuthorityDirectory(spec.scope, host));
    if (spec.schemaVersion === 2 && authority !== spec.authorityDirectory)
        throw new Error("程序升级不能改变已配置的卷外身份目录");
    return parseManagerServiceSpec({
        ...spec,
        schemaVersion: 2,
        authorityDirectory: authority,
    }) as ManagerServiceSpecV2;
}
