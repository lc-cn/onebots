import { Activity, ActivityTypes } from "@microsoft/agents-activity";
import type { ResourceResponse } from "@microsoft/agents-hosting";
import { materializeMediaSource, type MediaSourceInput } from "onebots";
import { TeamsApiError } from "./errors.js";

interface PendingFileConsent {
    activityId: string;
    conversationId: string;
    uploadUrl: string;
    contentUrl: string;
    uniqueId: string;
    fileType: string;
    fileName: string;
    upload?: TeamsFileUploadResult;
}

export interface TeamsFileUploadResult {
    status: number;
    etag?: string;
}

export interface TeamsFileConsentResult {
    upload: TeamsFileUploadResult;
    message: ResourceResponse;
}

/** 只允许消费已认证 fileConsent/invoke 中收到的一次性上传会话。 */
export class TeamsFileConsentManager {
    private readonly pending = new Map<string, PendingFileConsent>();
    private readonly operations = new Map<string, Promise<TeamsFileConsentResult>>();

    constructor(
        private readonly sendActivity: (
            conversationId: string,
            activity: Activity,
        ) => Promise<ResourceResponse>,
    ) {}

    capture(activity: Activity): void {
        if (activity.type !== ActivityTypes.Invoke || activity.name !== "fileConsent/invoke")
            return;
        const value = record(activity.value, "value");
        if (value.action !== "accept" || value.type !== "fileUpload") return;
        const uploadInfo = record(value.uploadInfo, "value.uploadInfo");
        const consent: PendingFileConsent = {
            activityId: required(activity.id, "activity.id"),
            conversationId: required(activity.conversation?.id, "activity.conversation.id"),
            uploadUrl: httpsUrl(uploadInfo.uploadUrl, "value.uploadInfo.uploadUrl"),
            contentUrl: httpsUrl(uploadInfo.contentUrl, "value.uploadInfo.contentUrl"),
            uniqueId: required(uploadInfo.uniqueId, "value.uploadInfo.uniqueId"),
            fileType: required(uploadInfo.fileType, "value.uploadInfo.fileType"),
            fileName: required(uploadInfo.name, "value.uploadInfo.name"),
        };
        this.pending.set(consent.activityId, consent);
    }

    complete(activityId: string, source: MediaSourceInput): Promise<TeamsFileConsentResult> {
        const active = this.operations.get(activityId);
        if (active) return active;
        const consent = this.pending.get(activityId);
        if (!consent) {
            return Promise.reject(
                new TeamsApiError("Teams 文件同意事件不存在、已完成或已过期", {
                    code: "TEAMS_FILE_CONSENT_NOT_FOUND",
                    details: { activityId },
                }),
            );
        }
        const operation = this.completePending(consent, source);
        this.operations.set(activityId, operation);
        void operation.finally(() => this.operations.delete(activityId)).catch(() => undefined);
        return operation;
    }

    private async completePending(
        consent: PendingFileConsent,
        source: MediaSourceInput,
    ): Promise<TeamsFileConsentResult> {
        consent.upload ??= await uploadFile(consent.uploadUrl, source);
        const activity = new Activity(ActivityTypes.Message);
        activity.attachments = [
            {
                contentType: "application/vnd.microsoft.teams.card.file.info",
                contentUrl: consent.contentUrl,
                name: consent.fileName,
                content: { uniqueId: consent.uniqueId, fileType: consent.fileType },
            },
        ];
        const message = await this.sendActivity(consent.conversationId, activity);
        this.pending.delete(consent.activityId);
        return { upload: consent.upload, message };
    }
}

async function uploadFile(
    uploadUrl: string,
    source: MediaSourceInput,
): Promise<TeamsFileUploadResult> {
    const media = await materializeMediaSource(source);
    const response = await fetch(new URL(uploadUrl), {
        method: "PUT",
        headers: {
            "content-type": "application/octet-stream",
            "content-length": String(media.data.byteLength),
            "content-range": `bytes 0-${media.data.byteLength - 1}/${media.data.byteLength}`,
        },
        body: Buffer.from(media.data),
    });
    if (response.status !== 200 && response.status !== 201) {
        throw new TeamsApiError(`Teams 文件上传失败: ${response.status}`, {
            code: "TEAMS_FILE_UPLOAD_ERROR",
            status: response.status,
            details: await response.text(),
        });
    }
    return { status: response.status, etag: response.headers.get("etag") || undefined };
}

function record(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalidConsent(`${name} 必须是对象`);
    }
    return value as Record<string, unknown>;
}

function required(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw invalidConsent(`${name} 不能为空`);
    }
    return value.trim();
}

function httpsUrl(value: unknown, name: string): string {
    const text = required(value, name);
    if (!URL.canParse(text)) throw invalidConsent(`${name} 必须是 HTTPS URL`);
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password) {
        throw invalidConsent(`${name} 必须是无凭据的 HTTPS URL`);
    }
    return text;
}

function invalidConsent(message: string): TeamsApiError {
    return new TeamsApiError(`Teams file consent ${message}`, {
        code: "TEAMS_FILE_CONSENT_INVALID",
    });
}
