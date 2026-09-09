import * as path from "node:path";
import type { DoctorCheck } from "./doctor-endpoint.js";
import { inspectSensitiveDirectoryMutationPermissions } from "./doctor-permissions.js";

/** 文件权限不能抵御可写父目录中的服务定义路径替换。 */
export function inspectServiceDefinitionDirectoryPermissions(definitionPath: string): DoctorCheck {
    return inspectSensitiveDirectoryMutationPermissions(
        path.dirname(definitionPath),
        "service-definition-dir-mode",
        "服务定义目录",
        "服务定义",
    );
}
