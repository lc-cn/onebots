import net from "node:net";

/** 连接原生宿主预创建的私有管道；返回的 socket 由本地 HTTP server 接管。 */
export function connectWindowsManagerRPC(pipeName: string): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const connection = net.createConnection(pipeName);
        const timeout = setTimeout(
            () => connection.destroy(new Error("Windows 原生宿主 RPC 连接超时")),
            10_000,
        );
        timeout.unref();
        connection.once("connect", () => {
            clearTimeout(timeout);
            resolve(connection);
        });
        connection.once("error", error => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}
