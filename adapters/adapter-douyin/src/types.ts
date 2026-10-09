export type DouyinLoginMethod = "qr" | "sms" | "password";

export interface DouyinConfig {
    account_id: string;
    login_method?: DouyinLoginMethod;
    mobile?: string;
    password?: string;
    login_timeout_seconds?: number;
}
