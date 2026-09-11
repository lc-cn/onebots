import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonResponse } from "./http-utils.js";

/** 管理端静态资源，与网关的协议代理和生命周期无关。 */
export function serveControlWeb(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    webRoot: string,
): boolean {
    if (request.method !== "GET" || (pathname !== "/" && !pathname.startsWith("/assets/")))
        return false;
    const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    const file = path.resolve(webRoot, relative);
    if (!file.startsWith(`${path.resolve(webRoot)}${path.sep}`) || !fs.existsSync(file)) {
        jsonResponse(response, 404, { message: "管理端产物不存在，请完成 Web 构建" });
        return true;
    }
    const contentType = file.endsWith(".html")
        ? "text/html; charset=utf-8"
        : file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".woff2")
              ? "font/woff2"
              : "application/octet-stream";
    response.writeHead(200, {
        "Content-Type": contentType,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(file)
        .on("error", () => response.destroy())
        .pipe(response);
    return true;
}
