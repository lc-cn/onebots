import type { WechatClient } from "./client.js";
import { defineWechatActionContract } from "./platform-action-contract.js";
import type { WechatActionHandler, WechatActionParams } from "./platform-action-context.js";
import {
    invalid,
    mediaIdAction,
    optionalBoolean,
    optionalInteger,
    post,
    postRecordAction,
    requireInteger,
    requireString,
    staticCall,
    uploadMedia,
} from "./platform-action-params.js";

/** 素材、草稿与发布生命周期动作。 */
export const WECHAT_CONTENT_ACTIONS = defineWechatActionContract(
    {
        upload_temporary_media: uploadMedia,
        get_temporary_media: async (client: WechatClient, params: WechatActionParams) =>
            client.call({
                path: "/cgi-bin/media/get",
                query: { media_id: requireString(params, "media_id") },
                responseType: "buffer",
            }),
        add_material: async (client: WechatClient, params: WechatActionParams) =>
            uploadMedia(client, params, "/cgi-bin/material/add_material"),
        add_news_material: postRecordAction("/cgi-bin/material/add_news", "news"),
        upload_news_image: async (client: WechatClient, params: WechatActionParams) =>
            uploadMedia(client, params, "/cgi-bin/media/uploadimg", false),
        update_news_material: postRecordAction("/cgi-bin/material/update_news", "article"),
        get_material_count: staticCall("/cgi-bin/material/get_materialcount"),
        get_material_batch: postRecordAction("/cgi-bin/material/batchget_material", "request"),
        get_material: async (client: WechatClient, params: WechatActionParams) =>
            client.call({
                method: "POST",
                path: "/cgi-bin/material/get_material",
                body: { media_id: requireString(params, "media_id") },
                responseType: optionalBoolean(params, "binary") ? "buffer" : "json",
            }),
        delete_material: mediaIdAction("/cgi-bin/material/del_material"),
        add_draft: postRecordAction("/cgi-bin/draft/add", "draft"),
        update_draft: postRecordAction("/cgi-bin/draft/update", "draft"),
        get_draft: mediaIdAction("/cgi-bin/draft/get"),
        delete_draft: mediaIdAction("/cgi-bin/draft/delete"),
        get_draft_count: staticCall("/cgi-bin/draft/count"),
        get_draft_batch: postRecordAction("/cgi-bin/draft/batchget", "request"),
        publish_draft: mediaIdAction("/cgi-bin/freepublish/submit"),
        get_publish_status: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/freepublish/get", {
                publish_id: requireString(params, "publish_id"),
            }),
        get_published_articles: postRecordAction("/cgi-bin/freepublish/batchget", "request"),
        get_published_article: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/freepublish/getarticle", {
                article_id: requireString(params, "article_id"),
            }),
        delete_published_article: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/freepublish/delete", {
                article_id: requireString(params, "article_id"),
                index: optionalInteger(params, "index"),
            }),
        open_article_comments: articleCommentAction("/cgi-bin/comment/open"),
        close_article_comments: articleCommentAction("/cgi-bin/comment/close"),
        list_article_comments: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/comment/list", {
                ...articleCommentTarget(params),
                begin: optionalInteger(params, "begin"),
                count: optionalInteger(params, "count", 1, 50),
                type: optionalCommentType(params),
            }),
        mark_article_comment_selected: articleCommentAction("/cgi-bin/comment/markelect", true),
        unmark_article_comment_selected: articleCommentAction("/cgi-bin/comment/unmarkelect", true),
        delete_article_comment: articleCommentAction("/cgi-bin/comment/delete", true),
        reply_article_comment: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/comment/reply/add", {
                ...articleCommentTarget(params),
                user_comment_id: requireInteger(params, "comment_id", 1),
                content: requireString(params, "content"),
            }),
        delete_article_comment_reply: articleCommentAction("/cgi-bin/comment/reply/delete", true),
    } satisfies Readonly<Record<string, WechatActionHandler>>,
    {
        upload_temporary_media: ["data", "type", "mime_type", "filename", "description"],
        get_temporary_media: ["media_id"],
        add_material: ["data", "type", "mime_type", "filename", "description"],
        add_news_material: ["news"],
        upload_news_image: ["data", "mime_type", "filename", "description"],
        update_news_material: ["article"],
        get_material_count: [],
        get_material_batch: ["request"],
        get_material: ["media_id", "binary"],
        delete_material: ["media_id"],
        add_draft: ["draft"],
        update_draft: ["draft"],
        get_draft: ["media_id"],
        delete_draft: ["media_id"],
        get_draft_count: [],
        get_draft_batch: ["request"],
        publish_draft: ["media_id"],
        get_publish_status: ["publish_id"],
        get_published_articles: ["request"],
        get_published_article: ["article_id"],
        delete_published_article: ["article_id", "index"],
        open_article_comments: ["message_data_id", "index"],
        close_article_comments: ["message_data_id", "index"],
        list_article_comments: ["message_data_id", "index", "begin", "count", "type"],
        mark_article_comment_selected: ["message_data_id", "index", "comment_id"],
        unmark_article_comment_selected: ["message_data_id", "index", "comment_id"],
        delete_article_comment: ["message_data_id", "index", "comment_id"],
        reply_article_comment: ["message_data_id", "index", "comment_id", "content"],
        delete_article_comment_reply: ["message_data_id", "index", "comment_id"],
    },
);

function articleCommentAction(path: string, includeCommentId = false): WechatActionHandler {
    return async (client, params) =>
        post(client, path, {
            ...articleCommentTarget(params),
            ...(includeCommentId
                ? { user_comment_id: requireInteger(params, "comment_id", 1) }
                : {}),
        });
}

function articleCommentTarget(params: WechatActionParams): Record<string, number> {
    const target: Record<string, number> = {
        msg_data_id: requireInteger(params, "message_data_id", 1),
    };
    const index = optionalInteger(params, "index");
    if (index !== undefined) target.index = index;
    return target;
}

function optionalCommentType(params: WechatActionParams): number | undefined {
    const type = optionalInteger(params, "type");
    if (type !== undefined && type !== 0 && type !== 1) {
        invalid("留言 type 仅支持 0（全部）或 1（精选）");
    }
    return type;
}
