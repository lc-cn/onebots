import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonResponse, readBody } from "./http-utils.js";
import type { ControlNotificationService } from "./notification-service.js";
import { BarkPartialDeliveryError } from "./notification-delivery.js";
import { ZodError } from "zod";

/** 控制认证在 host-http 的统一入口完成；此层只处理通知资源与输入边界。 */
export async function respondControlNotifications(
    service: ControlNotificationService | undefined,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
): Promise<boolean> {
    if (!pathname.startsWith("/api/control/notifications")) return false;
    if (!service) {
        jsonResponse(response, 503, { message: "通知存储不可用" });
        return true;
    }
    let action: "read" | "configure" | "test" | "retry" = "read";
    try {
        if (pathname === "/api/control/notifications" && request.method === "GET") {
            jsonResponse(response, 200, service.snapshot());
            return true;
        }
        if (pathname === "/api/control/notifications/config" && request.method === "POST") {
            action = "configure";
            const input = await readBody(request, 262_144);
            jsonResponse(response, 200, { config: service.configure(input) });
            return true;
        }
        const test = /^\/api\/control\/notifications\/channels\/([0-9a-f-]+)\/test$/i.exec(
            pathname,
        );
        if (test && request.method === "POST") {
            action = "test";
            await readBody(request, 1024);
            await service.test(test[1]);
            jsonResponse(response, 200, { delivered: true });
            return true;
        }
        const retry = /^\/api\/control\/notifications\/deliveries\/([0-9a-f-]+)\/retry$/i.exec(
            pathname,
        );
        if (retry && request.method === "POST") {
            action = "retry";
            await readBody(request, 1024);
            service.retry(retry[1]);
            jsonResponse(response, 200, { queued: true });
            return true;
        }
        jsonResponse(response, 404, { message: "通知接口不存在" });
    } catch (error) {
        const invalid =
            error instanceof ZodError ||
            error instanceof SyntaxError ||
            error instanceof TypeError ||
            (action === "configure" &&
                error instanceof Error &&
                /通知|渠道|规则|Webhook|Bark|URL|ID|HTTPS|邮件/.test(error.message));
        const safeDetail =
            error instanceof BarkPartialDeliveryError
                ? "Bark 部分设备投递失败；重试可能使成功设备重复收到通知"
                : error instanceof Error &&
                    /^(通知目标返回 HTTP \d+|通知目标解析到内网、本机或保留地址|通知目标响应超时|公网通知目标必须使用 HTTPS)$/.test(
                        error.message,
                    )
                  ? error.message
                  : undefined;
        jsonResponse(response, invalid ? 400 : action === "test" ? 502 : 503, {
            message:
                error instanceof ZodError
                    ? "通知配置字段无效，请检查必填项与地址格式"
                    : action === "test"
                      ? (safeDetail ?? "测试通知未能投递，请核对渠道地址、凭据和网络")
                      : error instanceof Error &&
                          /通知|渠道|规则|Webhook|Bark|URL|ID|HTTPS|邮件/.test(error.message)
                        ? error.message
                        : "通知操作失败，请检查配置和服务状态",
        });
    }
    return true;
}
