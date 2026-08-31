import {
    type Adapter,
    requireBooleanParam,
    requireNonEmptyStringParam,
    requirePositiveIntegerParam,
} from "onebots";

export const MILKY_FILE_ACTIONS = new Set([
    "upload_private_file",
    "upload_group_file",
    "get_private_file_download_url",
    "get_group_file_download_url",
    "get_group_files",
    "move_group_file",
    "rename_group_file",
    "delete_group_file",
    "persist_group_file",
    "create_group_folder",
    "rename_group_folder",
    "delete_group_folder",
]);

/** 封装 Milky 文件 URI、实体投影与可变动作，协议入口只负责分派。 */
export async function executeMilkyFileAction(
    adapter: Adapter,
    accountId: string,
    action: string,
    params: Record<string, unknown>,
): Promise<unknown> {
    switch (action) {
        case "get_group_files":
            return getGroupFiles(adapter, accountId, params);
        case "create_group_folder":
            return createGroupFolder(adapter, accountId, params);
        case "upload_private_file":
            return uploadFile(adapter, accountId, "private", params);
        case "upload_group_file":
            return uploadFile(adapter, accountId, "group", params);
        case "get_private_file_download_url":
            return getFileDownloadUrl(adapter, accountId, "private", params);
        case "get_group_file_download_url":
            return getFileDownloadUrl(adapter, accountId, "group", params);
        case "move_group_file":
            await moveGroupFile(adapter, accountId, params);
            return {};
        case "rename_group_file":
            await renameGroupFile(adapter, accountId, params);
            return {};
        case "delete_group_file":
            await deleteGroupFile(adapter, accountId, params);
            return {};
        case "persist_group_file":
            await persistGroupFile(adapter, accountId, params);
            return {};
        case "rename_group_folder":
            await renameGroupFolder(adapter, accountId, params);
            return {};
        case "delete_group_folder":
            await deleteGroupFolder(adapter, accountId, params);
            return {};
        default:
            throw new TypeError(`未知 Milky 文件动作: ${action}`);
    }
}

async function getGroupFiles(adapter: Adapter, accountId: string, params: Record<string, unknown>) {
    const groupId = requirePositiveIntegerParam(params, "group_id");
    const result = await adapter.getGroupFiles(accountId, {
        group_id: adapter.resolveId(groupId),
        parent_folder_id:
            typeof params.parent_folder_id === "string"
                ? adapter.resolveId(params.parent_folder_id)
                : undefined,
    });
    return {
        files: result.files.map(file => ({
            group_id: file.group_id?.number ?? groupId,
            file_id: file.file_id.string,
            file_name: file.file_name,
            parent_folder_id: file.parent_folder_id?.string ?? "/",
            file_size: file.file_size ?? 0,
            uploaded_time: nonNegativeInteger(file.uploaded_time, "uploaded_time"),
            ...(file.expire_time === undefined ? {} : { expire_time: file.expire_time }),
            uploader_id: positiveId(file.uploader_id?.number, "uploader_id"),
            downloaded_times: nonNegativeInteger(file.downloaded_times, "downloaded_times"),
        })),
        folders: result.folders.map(folder => ({
            group_id: folder.group_id?.number ?? groupId,
            folder_id: folder.folder_id.string,
            parent_folder_id: folder.parent_folder_id?.string ?? "/",
            folder_name: folder.folder_name,
            created_time: nonNegativeInteger(folder.created_time, "created_time"),
            last_modified_time: nonNegativeInteger(folder.last_modified_time, "last_modified_time"),
            creator_id: positiveId(folder.creator_id?.number, "creator_id"),
            file_count: nonNegativeInteger(folder.file_count, "file_count"),
        })),
    };
}

async function createGroupFolder(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    const folder = await adapter.createGroupFolder(accountId, {
        group_id: adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
        folder_name: requireNonEmptyStringParam(params, "folder_name"),
    });
    return { folder_id: folder.folder_id.string };
}

async function uploadFile(
    adapter: Adapter,
    accountId: string,
    scene: "private" | "group",
    params: Record<string, unknown>,
) {
    const sceneKey = scene === "private" ? "user_id" : "group_id";
    const uri = requireNonEmptyStringParam(params, "file_uri");
    const upload = await adapter.uploadFile(accountId, {
        scene_type: scene,
        scene_id: adapter.resolveId(requirePositiveIntegerParam(params, sceneKey)),
        name: requireNonEmptyStringParam(params, "file_name"),
        ...(uri.startsWith("base64://")
            ? { data: uri.slice("base64://".length) }
            : uri.startsWith("http://") || uri.startsWith("https://")
              ? { url: uri }
              : { path: uri }),
        folder_id:
            scene === "group"
                ? adapter.resolveId(
                      typeof params.parent_folder_id === "string" ? params.parent_folder_id : "/",
                  )
                : undefined,
    });
    return { file_id: upload.file_id.string };
}

async function getFileDownloadUrl(
    adapter: Adapter,
    accountId: string,
    scene: "private" | "group",
    params: Record<string, unknown>,
) {
    const sceneKey = scene === "private" ? "user_id" : "group_id";
    const url = await adapter.getFileDownloadUrl(accountId, {
        scene_type: scene,
        scene_id: adapter.resolveId(requirePositiveIntegerParam(params, sceneKey)),
        file_id: adapter.resolveId(requireNonEmptyStringParam(params, "file_id")),
        file_hash:
            scene === "private" ? requireNonEmptyStringParam(params, "file_hash") : undefined,
        is_self_send:
            scene === "private" && params.is_self_send !== undefined
                ? requireBooleanParam(params, "is_self_send")
                : undefined,
    });
    return { download_url: url };
}

async function moveGroupFile(adapter: Adapter, accountId: string, params: Record<string, unknown>) {
    await adapter.moveGroupFile(accountId, {
        group_id: adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
        file_id: adapter.resolveId(requireNonEmptyStringParam(params, "file_id")),
        target_folder_id: adapter.resolveId(
            typeof params.target_folder_id === "string" ? params.target_folder_id : "/",
        ),
    });
}

async function renameGroupFile(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    await adapter.renameGroupFile(accountId, {
        group_id: adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
        file_id: adapter.resolveId(requireNonEmptyStringParam(params, "file_id")),
        new_name: requireNonEmptyStringParam(params, "new_file_name"),
    });
}

async function deleteGroupFile(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    const groupId = requirePositiveIntegerParam(params, "group_id");
    await adapter.deleteFile(accountId, {
        scene_type: "group",
        scene_id: adapter.resolveId(groupId),
        file_id: adapter.resolveId(requireNonEmptyStringParam(params, "file_id")),
    });
}

async function persistGroupFile(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    await adapter.persistGroupFile(accountId, {
        group_id: adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
        file_id: adapter.resolveId(requireNonEmptyStringParam(params, "file_id")),
    });
}

async function renameGroupFolder(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    await adapter.renameGroupFolder(accountId, {
        group_id: adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
        folder_id: adapter.resolveId(requireNonEmptyStringParam(params, "folder_id")),
        new_name: requireNonEmptyStringParam(params, "new_folder_name"),
    });
}

async function deleteGroupFolder(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    await adapter.deleteGroupFolder(accountId, {
        group_id: adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
        folder_id: adapter.resolveId(requireNonEmptyStringParam(params, "folder_id")),
    });
}

function nonNegativeInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`Adapter 返回的 ${field} 必须是非负整数`);
    }
    return value;
}

function positiveId(value: unknown, field: string): number {
    const id = nonNegativeInteger(value, field);
    if (id === 0) throw new TypeError(`Adapter 返回的 ${field} 必须是正整数 ID`);
    return id;
}
