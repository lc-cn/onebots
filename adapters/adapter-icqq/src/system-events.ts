/** ICQQ 登录事件。 */
export interface ICQQLoginEvent {
    uin: number;
}

/** ICQQ 上线事件。 */
export interface ICQQOnlineEvent {
    uin: number;
}

/** ICQQ 离线事件。 */
export interface ICQQOfflineEvent {
    uin: number;
    message: string;
}

/** 滑块验证码事件。 */
export interface ICQQSliderEvent {
    url: string;
}

/** 设备锁验证事件。 */
export interface ICQQDeviceEvent {
    url: string;
    phone: string;
}

/** 登录错误事件。 */
export interface ICQQLoginErrorEvent {
    code: number;
    message: string;
}

/** 二维码登录事件。 */
export interface ICQQQRCodeEvent {
    image: Buffer;
}

/** 身份验证页面要求使用的设备信息。 */
export interface ICQQAuthDevice {
    guid: string;
    qimei: string;
    qimei36: string;
    subappid: string;
    platform: string;
    brand: string;
    model: string;
    bssid: string;
    devInfo: string;
    sysVersion: string;
}

/** 身份验证事件。 */
export interface ICQQAuthEvent {
    url: string;
    device: ICQQAuthDevice;
}
