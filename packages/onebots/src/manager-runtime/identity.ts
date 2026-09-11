import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { canonicalServiceJson } from "../service-operation-storage.js";
import { readVerifiedManagerCandidate, type VerifiedManagerCandidate } from "./reader.js";

/** 绑定唯一候选及两份验证记录，不把相同安装计划当作相同工件。 */
export function managerCandidateDigest(candidate: VerifiedManagerCandidate): string {
    return createHash("sha256")
        .update(
            canonicalServiceJson({
                storeId: candidate.receipt.storeId,
                id: candidate.id,
                receipt: candidate.receipt,
                management: candidate.management,
            }),
        )
        .digest("hex");
}

/**
 * 仅由可信host传入自身import.meta.url；不是HTTP路径解析器。
 * 路径与收据绑定不证明全部JS字节不可变，工件目录仍须由可信用户独占。
 */
export function readRunningManagerCandidate(hostModuleUrl: string): VerifiedManagerCandidate {
    const failure = () => new Error("运行中的管理程序候选身份无法确认");
    try {
        const url = new URL(hostModuleUrl);
        if (url.protocol !== "file:" || url.search || url.hash) throw failure();
        const modulePath = fs.realpathSync(fileURLToPath(url));
        const stat = fs.lstatSync(modulePath);
        if (!stat.isFile()) throw failure();
        let directory = path.dirname(modulePath);
        // npm和pnpm布局均可定位，但只接受同一候选内解析出的精确host入口。
        for (let depth = 0; depth < 24; depth++) {
            if (/^[a-f0-9-]{36}$/.test(path.basename(directory))) {
                const candidate = readVerifiedManagerCandidate(
                    path.dirname(directory),
                    path.basename(directory),
                );
                const entry = fs.realpathSync(
                    path.join(directory, "node_modules/onebots/lib/control/host.js"),
                );
                if (entry !== modulePath || !entry.startsWith(`${directory}${path.sep}`))
                    throw failure();
                return candidate;
            }
            const parent = path.dirname(directory);
            if (parent === directory) break;
            directory = parent;
        }
        throw failure();
    } catch {
        throw failure();
    }
}
