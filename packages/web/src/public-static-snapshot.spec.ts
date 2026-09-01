import { describe, expect, it } from "vitest";
import {
    assertPublicStaticMutationAcknowledgement,
    buildPublicStaticMutationHeaders,
    parsePublicStaticSnapshot,
    PUBLIC_STATIC_REVISION_HEADER,
} from "./public-static-snapshot.js";

const revision = `sha256:${"a".repeat(64)}`;
const nextRevision = `sha256:${"b".repeat(64)}`;
const identity = {
    application: "onebots",
    version: "1.2.8",
    instanceId: "instance-a",
    runtimeContractId: "sha256:contract-a",
};

function response(instanceId = "instance-a", staticRevision = revision): Response {
    return new Response(null, {
        headers: {
            "X-OneBots-Application": "onebots",
            "X-OneBots-Version": "1.2.8",
            "X-OneBots-Instance-Id": instanceId,
            "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
            [PUBLIC_STATIC_REVISION_HEADER]: staticRevision,
        },
    });
}

describe("public static management snapshot", () => {
    it("闭合列表响应头、正文身份和目录修订", () => {
        expect(
            parsePublicStaticSnapshot(response(), {
                success: true,
                application: "onebots",
                instance_id: "instance-a",
                static_revision: revision,
                files: ["a.txt", "b.html"],
                root: "/srv/onebots/static",
            }),
        ).toEqual({
            identity,
            revision,
            files: ["a.txt", "b.html"],
            root: "/srv/onebots/static",
        });
        expect(() =>
            parsePublicStaticSnapshot(response(), {
                success: true,
                application: "onebots",
                instance_id: "instance-b",
                static_revision: revision,
                files: [],
                root: "/srv/onebots/static",
            }),
        ).toThrow("响应契约无效");
        expect(() =>
            parsePublicStaticSnapshot(response("instance-a", "invalid"), {
                success: true,
            }),
        ).toThrow("缺少有效目录修订号");
    });

    it("构造实例与目录修订前置条件", () => {
        expect(buildPublicStaticMutationHeaders(identity, revision)).toEqual({
            "X-OneBots-Expected-Instance-Id": "instance-a",
            "X-OneBots-Expected-Public-Static-Revision": revision,
        });
        expect(() => buildPublicStaticMutationHeaders(identity, "invalid")).toThrow(
            "缺少有效目录修订号",
        );
    });

    it("只接受同一实例携带新目录修订的写入回执", () => {
        expect(
            assertPublicStaticMutationAcknowledgement(
                response("instance-a", nextRevision),
                {
                    success: true,
                    application: "onebots",
                    instance_id: "instance-a",
                    static_revision: nextRevision,
                },
                identity,
            ),
        ).toBe(nextRevision);
        expect(() =>
            assertPublicStaticMutationAcknowledgement(
                response("instance-b", nextRevision),
                {
                    success: true,
                    application: "onebots",
                    instance_id: "instance-b",
                    static_revision: nextRevision,
                },
                identity,
            ),
        ).toThrow("回执实例不匹配");
        expect(() =>
            assertPublicStaticMutationAcknowledgement(
                response("instance-a", nextRevision),
                {
                    success: true,
                    application: "onebots",
                    instance_id: "instance-a",
                    static_revision: revision,
                },
                identity,
            ),
        ).toThrow("缺少可信的新目录修订");
    });
});
