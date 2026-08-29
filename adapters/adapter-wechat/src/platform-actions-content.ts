import type { WechatClient } from "./client.js";
import type { WechatActionHandler, WechatActionParams } from "./platform-action-context.js";
import {
    mediaIdAction,
    optionalBoolean,
    optionalNumber,
    post,
    postRecordAction,
    requireString,
    staticCall,
    uploadMedia,
} from "./platform-action-params.js";

/** 素材、草稿与发布生命周期动作。 */
export const WECHAT_CONTENT_ACTIONS = {
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
    delete_published_article: async (client: WechatClient, params: WechatActionParams) =>
        post(client, "/cgi-bin/freepublish/delete", {
            article_id: requireString(params, "article_id"),
            index: optionalNumber(params, "index"),
        }),
} satisfies Readonly<Record<string, WechatActionHandler>>;
