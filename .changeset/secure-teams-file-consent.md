---
"@onebots/adapter-teams": patch
---

将 Teams file consent 上传绑定到已认证的 accept Invoke Activity：`complete_file_consent_upload` 改用 `consent_activity_id`，不再接受调用方指定上传 URL、会话和 file-info 元数据，并支持并发合并及上传后回执重试。
