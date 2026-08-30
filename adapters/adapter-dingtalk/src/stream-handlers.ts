import {
    EventAck,
    TOPIC_CARD,
    TOPIC_ROBOT,
    type DWClient,
    type DWClientDownStream,
} from "dingtalk-stream";
import { ErrorCategory } from "onebots";
import { DingTalkError } from "./errors.js";
import { isRobotMessage, parseObject, streamEvent } from "./inbound.js";
import type { DingTalkEvent, DingTalkRobotMessage } from "./types.js";

interface DingTalkStreamHandlers {
    isCurrent(): boolean;
    robot(message: DingTalkRobotMessage, raw: DWClientDownStream): void | Promise<void>;
    card(event: DingTalkEvent, raw: DWClientDownStream): void | Promise<void>;
    event(event: DingTalkEvent, raw: DWClientDownStream): void | Promise<void>;
    error(error: DingTalkError): void;
}

/** 注册 Stream 投递边界；只有业务处理成功才确认，失败事件交由钉钉重投。 */
export function registerDingTalkStreamHandlers(
    stream: DWClient,
    handlers: DingTalkStreamHandlers,
): void {
    stream.registerCallbackListener(TOPIC_ROBOT, async message => {
        if (!handlers.isCurrent()) return;
        try {
            const data = parseObject(message.data, "钉钉 Stream 机器人消息");
            if (!isRobotMessage(data)) {
                throw DingTalkError.protocol(
                    "钉钉 Stream 机器人消息缺少必要字段",
                    "DINGTALK_ROBOT_MESSAGE_INVALID",
                );
            }
            await handlers.robot(data, message);
            stream.socketCallBackResponse(message.headers.messageId, { success: true });
        } catch (error) {
            handlers.error(
                DingTalkError.wrap(error, "DINGTALK_ROBOT_DELIVERY_FAILED", ErrorCategory.RUNTIME),
            );
            stream.socketCallBackResponse(message.headers.messageId, { success: false });
        }
    });
    stream.registerCallbackListener(TOPIC_CARD, async message => {
        if (!handlers.isCurrent()) return;
        try {
            await handlers.card(streamEvent(message), message);
            stream.socketCallBackResponse(message.headers.messageId, { success: true });
        } catch (error) {
            handlers.error(
                DingTalkError.wrap(error, "DINGTALK_CARD_DELIVERY_FAILED", ErrorCategory.RUNTIME),
            );
            stream.socketCallBackResponse(message.headers.messageId, { success: false });
        }
    });
    stream.registerAllEventListener(async message => {
        if (!handlers.isCurrent()) return { status: EventAck.SUCCESS };
        try {
            await handlers.event(streamEvent(message), message);
            return { status: EventAck.SUCCESS };
        } catch (error) {
            handlers.error(
                DingTalkError.wrap(error, "DINGTALK_EVENT_DELIVERY_FAILED", ErrorCategory.RUNTIME),
            );
            return { status: EventAck.LATER, message: "OneBots event delivery failed" };
        }
    });
}
