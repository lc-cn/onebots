import {Dict} from './types'

export enum MusicPlatform {
    qq = "qq",
    netease = "163",
}
export interface Quotable{
    event_id?:string;
    message_id?:string
}
export interface MessageElemMap {
    text: {
        text: string;
    };
    at: {
        /** 在频道消息中该值为0 */
        qq: number | "all"
        /** 频道中的`tiny_id` */
        id?: string | "all"
        /** AT后跟的字符串，接收消息时有效 */
        text?: string
        /** 假AT */
        dummy?: boolean
    };
    face: {
        /** face为0~348，sface不明 */
        id: number
        /** 表情说明，接收消息时有效 */
        text?: string
        /** 大表情 */
        qlottie?: string
    };
    image: {
        /**
         * @type {string} 本地图片文件路径，例如`"/tmp/1.jpg"`
         * @type {Buffer} 图片`Buffer`
         */
        file: string | Buffer
        /** 网络图片是否使用缓存 */
        cache?: boolean
        /** 流的超时时间，默认60(秒) */
        timeout?: number
        headers?: import("http").OutgoingHttpHeaders
        /** 图片url地址，接收时有效 */
        url?: string
        /** 是否作为表情发送 */
        asface?: boolean
        /** 是否显示下载原图按钮 */
        origin?: boolean
    };
    video: {
        /**
         * 需要`ffmpeg`和`ffprobe`
         * @type {string} 本地视频文件路径，例如`"/tmp/1.mp4"`
         */
        file: string
        /** 视频名，接收时有效 */
        name?: string
        /** 作为文件的文件id，接收时有效 */
        fid?: string
        md5?: string
        /** 文件大小，接收时有效 */
        size?: number
        /** 视频时长（秒），接收时有效 */
        seconds?: number
    };
    audio: {
        /**
         * 支持`raw silk`和`amr`文件
         * @type {string} 本地语音文件路径，例如`"/tmp/1.slk"`
         * @type {Buffer} ptt buffer (silk or amr)
         */
        file: string | Buffer
        /** 语言url地址，接收时有效 */
        url?: string
        md5?: string
        /** 文件大小，接收时有效 */
        size?: number
        /** 语音时长（秒），接收时有效 */
        seconds?: number
    };
    xml: {
        id?:number
        data: string;
    };
    json: {
        res_id?:string
        data: string|Record<string, any>;
    };
    markdown:{
        content:string
    }
    // app: {
    //     app: string;
    // };
    music: {
        id: number;
        platform: MusicPlatform;
    };
    reply: Quotable;
    link:{
        channel_id:string
    };
    button:{
        data:Dict
    }
}

export type MessageElemType = keyof MessageElemMap;
// 消息元素
export type MessageElem<T extends MessageElemType = MessageElemType> = {
    type: T;
} & MessageElemMap[T];
// 可以发送的消息类型
export type TextElem = MessageElem<"text">;
export type AtElem = MessageElem<"at">;
export type FaceElem = MessageElem<"face">;
export type ImageElem = MessageElem<"image">;
export type VideoElem = MessageElem<"video">;
export type AudioElem = MessageElem<"audio">;
export type LinkElem = MessageElem<'link'>
export type XmlElem = MessageElem<"xml">;
export type JsonElem = MessageElem<"json">;
export type MDElem=MessageElem<'markdown'>
export type MusicElem = MessageElem<"music">;
export type ButtonElem = MessageElem<'button'>
export type ReplyElem = MessageElem<"reply">;

// 重复组合的消息元素
type RepeatableCombineElem = TextElem | FaceElem | ImageElem | AtElem| ButtonElem;
// 带回复的消息元素
type WithReply<T extends MessageElem> =
    | T
    | [T]
    | [ReplyElem, T]
    | [ReplyElem, ...RepeatableCombineElem[]];
// 可发送的消息元素
export type Sendable =
    | string // 文本
    | RepeatableCombineElem
    | (RepeatableCombineElem|string)[] // 可重复组合的消息元素
    | WithReply<
    | MDElem
    | LinkElem // 链接元素
    | VideoElem // 视频消息元素
    | AudioElem // 语音消息元素
    | XmlElem // Xml消息元素
    | MusicElem // 音乐消息元素
    | JsonElem // Json消息元素
>; // 带回复的消息元素
