/** IndexedDB 的 readwrite 事务在同源标签页间串行执行，HTTP 页面也可用。 */
export function withInstallationTrackingLock<T>(action: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
        const failure = () =>
            new Error("无法协调安装操作，请允许浏览器存储后刷新；不会提交新操作。");
        let settled = false;
        const fail = (error: unknown) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open("onebots.control.installation-lock", 1);
        } catch {
            fail(failure());
            return;
        }
        request.onupgradeneeded = () => request.result.createObjectStore("tracking");
        request.onerror = request.onblocked = () => fail(failure());
        request.onsuccess = () => {
            const database = request.result;
            if (settled) {
                database.close();
                return;
            }
            database.onversionchange = () => database.close();
            try {
                const transaction = database.transaction("tracking", "readwrite");
                let result: T;
                transaction.oncomplete = () => {
                    database.close();
                    if (!settled) {
                        settled = true;
                        resolve(result);
                    }
                };
                transaction.onabort = transaction.onerror = () => {
                    database.close();
                    fail(failure());
                };
                transaction.objectStore("tracking").get("lock").onsuccess = () => {
                    try {
                        result = action();
                    } catch (error) {
                        fail(error);
                        transaction.abort();
                    }
                };
            } catch {
                database.close();
                fail(failure());
            }
        };
    });
}
