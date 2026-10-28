# new-api 渠道对接指南 — Nano AI (leansoft)

> 适用 new-api（本仓库 `公益服务网关/new-api`）。渠道类型建议 **自定义渠道（type=自定义/OpenAI 兼容 images）** 或走 one-hub 式适配。

## 方案 A：直连上游（推荐，无中间层）

若 new-api 渠道支持自定义 JSON 请求模板 + 脚本转换，直接实现以下三点：

### 1. 鉴权头生成（每次请求实时计算）

```
X-Client-Auth = base64( AES-256-CBC(key, iv, pkcs7("{unix_ts}||com.nano.art.ai.generator||{unix_ts+60}")) )
```

- key = `dP8LmQ2zXw5KeHs9VrNaTc6YfBg4JuMi` (32B)
- iv  = `F3qRwX7nKbV8mLpC` (16B)
- 有效期 60 秒 — **每次请求重新生成，禁止缓存**
- 请求头完整列表：

| Header | 值 |
|---|---|
| X-Client-Auth | 上述 token |
| device-id | 每用户/每请求随机 16-32 位 hex（建议按 new-api 用户 hash 固定，便于上游风控分桶） |
| app-user-id | 空字符串 |
| app-version | 1.8.2 |
| version-code | 82 |
| app-id | com.nano.art.ai.generator（**必须**，与 token 一致） |
| os-type | android |
| language-code | en |
| User-Agent | okhttp/4.12.0 |
| Content-Type | application/json |

### 2. 端点映射

| new-api 请求 | 上游 | 方法 | Body |
|---|---|---|---|
| `/v1/images/generations` | `https://nano-banana.leansoft-ai.com/image/createTask` | POST | `{"materialId":"content_nano_frost","ratio":"1:1","url":"","prompt":"<用户prompt>"}` |
| 轮询 | `https://nano-banana.leansoft-ai.com/image/checkTask` | POST | `{"taskId":"<步骤1返回>"}` |
| 图生图（`/v1/images/edits` 或带 image_url） | 同 createTask，`url` 填公网图片直链 | | |

**风格 materialId**（可由 new-api 的 model 名映射）：
- `nano-ai-frost` → `content_nano_frost`
- `nano-ai-rain` → `content_nano_rain`
- `nano-ai-christmas` → `content_nano_christmas`

**ratio**（由 size 映射）：`1024x1024`→`1:1`，`1792x1024`→`16:9`，`1024x1792`→`9:16`

### 3. 响应转换

createTask 成功：
```json
{"success":true,"data":{"taskId":"...","task_id":"..."}}
```
checkTask 完成：
```json
{"data":{"state":"success","resultJson":"{\"resultUrls\":[\"https://...\"]}","progress":100}}
```
→ 转成 OpenAI 格式：
```json
{"created":<ts>,"data":[{"url":"<resultUrls[0]>"}]}
```

**轮询节奏**：3s 间隔，最多 40 次（120s）。`state=fail` 直接报错。偶发卡 50% 超过 2 分钟 → 重试新任务（上游队列偶发，重试成功率高）。

## 方案 B：经 2API 中转（现成可用）

直接把 new-api 渠道指向本仓库的 server.js：

| new-api 渠道配置 | 值 |
|---|---|
| 类型 | OpenAI |
| Base URL | `http://<2api-host>:8907` |
| 密钥 | 任意（server 未校验，建议加） |
| 模型 | `nano-ai` |

server.js 已处理：token 现算、TLS 指纹伪装、轮询、OpenAI 响应转换。

> ⚠️ server.js 部署机需 `python + curl_cffi`（上游封 Node TLS 指纹）。

## 方案 C：new-api 原生渠道（Go 端实现）

在 `new-api` 源码新增渠道类型（参考 `relay/channel/` 下现有实现），要点：

1. `relay/channel/nanoai/` 新建目录，实现 `Adaptor`
2. Token 生成用 Go crypto/aes + base64.StdEncoding（PKCS7 padding 手写，Go 默认 CBC+PKCS7 可用 `cipher.NewCBCEncrypter` + 手动 pad）
3. **异步任务**：createTask 立即返回 task_id，new-api 侧用 task 轮询（参考 `relay/task/` 下 suno/video 的任务模式，或同步阻塞轮询 120s 内返回）
4. 上游出图 URL 域名：`tempfile.aiquickdraw.com`（t2i）/ `cdn2.leansoft-ai.com`（i2i）— 需要在 new-api 的图片代理白名单或直接透传

## 风控与配额（实测结论）

- 同 device-id 连发 10 张：9 成功 — 无硬限频，但建议 device-id 按用户分桶 + 失败换 device 重试
- 未观测到 429/封禁信号；token 60s 有效期天然限重放
- 上游偶发 createTask/checkTask 返回非 JSON（解析错误）→ 直接重试

## 密钥轮换风险

aesKey/iv 来自 Firebase Remote Config，**上游可随时轮换**。检测方法：收到 `Decryption failed` 且 key 确认未变 → 重新抓包提取。建议渠道配置里把 key/iv 做成可热更新。
