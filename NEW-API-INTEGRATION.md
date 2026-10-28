# new-api 渠道对接指南 — Nano AI (leansoft)

> **纯协议直连已验证可行**：Go 标准库 `net/http` 直连上游 10/10 通过（无需代理、无需 utls）。
> 参考实现：本仓库 `go-client/nanoai.go`（可直接运行，`go run nanoai.go` 出图）。

---

## 方案 A：new-api 原生 Go 渠道（推荐 ⭐）

new-api 本身是 Go，**直接用标准库直连，无需任何中转层**。
参考 `go-client/nanoai.go`（约 200 行，零第三方依赖）。

### 1. 鉴权头（每请求现算）

```
X-Client-Auth = base64( AES-256-CBC-PKCS7( key, iv, "{unix_ts}||com.nano.art.ai.generator||{unix_ts+60}" ) )
```

- key = `dP8LmQ2zXw5KeHs9VrNaTc6YfBg4JuMi`（32B）
- iv  = `F3qRwX7nKbV8mLpC`（16B）
- **有效期 60 秒 → 每请求重算，禁止缓存**

Go 实现要点（见参考文件 `BuildToken()`）：
```go
block, _ := aes.NewCipher([]byte(AppKey))
padLen := block.BlockSize() - len(plain)%block.BlockSize()
padded := append([]byte(plain), bytes.Repeat([]byte{byte(padLen)}, padLen)...)
out := make([]byte, len(padded))
cipher.NewCBCEncrypter(block, []byte(AppIv)).CryptBlocks(out, padded)
tok := base64.StdEncoding.EncodeToString(out)
```

### 2. 请求头

| Header | 值 | 说明 |
|---|---|---|
| X-Client-Auth | 上述 token | 必填 |
| device-id | 非空随机 hex / 按用户 hash 派生 | **必填非空**，空 → `Missing required headers` |
| app-user-id | `""` | 空串可以 |
| app-version | `1.8.2` | |
| version-code | `82` | 数字 |
| language-code | `en` | |
| app-id | `com.nano.art.ai.generator` | **必须与 token 明文一致**，否则 `Decryption failed` |
| os-type | `android` | |
| User-Agent | `okhttp/4.12.0` | |
| Content-Type | `application/json` | |

### 3. 端点映射

| new-api 请求 | 上游 | Body |
|---|---|---|
| `/v1/images/generations` | `POST https://nano-banana.leansoft-ai.com/image/createTask` | `{"materialId":"content_nano_frost","ratio":"1:1","url":"","prompt":"<用户prompt>"}` |
| （轮询） | `POST .../image/checkTask` | `{"taskId":"<上一步返回>"}` |
| `/v1/images/edits`（图生图） | 同 createTask，`url` 填公网图片直链 | `{"materialId":...,"ratio":"1:1","url":"<图片URL>","prompt":...}` |

**model 名 → materialId**（建议在渠道模型配置里做映射）：
| 模型名 | materialId |
|---|---|
| `nano-ai` / `nano-ai-frost` | `content_nano_frost` |
| `nano-ai-rain` | `content_nano_rain` |
| `nano-ai-christmas` | `content_nano_christmas` |

**size → ratio**：`1024x1024`→`1:1`，`1792x1024`→`16:9`，`1024x1792`→`9:16`，`768x1024`→`3:4`

### 4. 响应转换

createTask：
```json
{"success":true,"data":{"taskId":"...","task_id":"..."}}
```

checkTask 完成后：
```json
{"success":true,"data":{"state":"success","progress":100,
  "resultJson":"{\"resultUrls\":[\"https://tempfile.aiquickdraw.com/nano-banana/xxx.png\"]}"}}
```

→ OpenAI 格式：
```json
{"created":<ts>,"data":[{"url":"<resultUrls[0]>"}]}
```
需要 b64_json 时由 new-api 侧下载转码（图片约 1.0-1.6MB）。

### 5. 轮询策略（关键）

- 间隔 **3s**，最多 **40 次（120s）**
- `state == "success"` → 取 `resultUrls[0]`
- `state == "fail"/"failed"` → 立即报错
- **超时不等于失败**：上游队列偶发卡 `generating 50%`，超时后**重试新任务**成功率高（实测）
- 单次请求网络抖动不要终止，`continue` 继续轮询

### 6. async/task 模式（可选优化）

上游本身就是异步 task（createTask 立即返回 taskId）。若 new-api 侧使用 `relay/task/` 的任务模式（参考 suno/video 渠道），可把 taskId 存库，由后台 worker 轮询，避免占用 HTTP 连接 30-40 秒。否则就同步阻塞轮询 120s 内返回。

---

## 方案 B：经 2API 中转（最快验证）

不想写 Go 代码时，把渠道指向本仓库的 server.js：

| 配置项 | 值 |
|---|---|
| 类型 | OpenAI |
| Base URL | `http://<2api-host>:8907` |
| 密钥 | 任意 |
| 模型 | `nano-ai` |

> ⚠️ 部署机需 `python` + `pip install curl_cffi cryptography`（Node TLS 会被上游拒，server.js 已内置 python 桥接）

---

## 风控与配额（实测）

| 探测项 | 结论 |
|---|---|
| 同 device-id 连发 10 张 | 9 成功 — 无硬限频，无 429/封禁信号 |
| 三风格（frost/rain/christmas） | 全部可用，20-40s 出图 |
| token 重放 | 60s 有效期天然限制 |
| device-id 为空 | 拒绝 `Missing required headers` |
| app-id 与 token 明文不一致 | 拒绝 `Decryption failed` |
| 错 key/iv | 拒绝 `Decryption failed` |

**建议**：device-id 按 new-api 用户 hash 派生（`sha256(userID)[:16]`），既稳定便于风控分桶，又不会全局共用一个 ID。

---

## 密钥轮换风险（重要）

`aesKey`/`aesIv` 来自 **Firebase Remote Config**，上游可随时轮换。

- 检测信号：原本正常的请求突然 `Decryption failed`，且 device-id/app-id/token 格式确认无误
- 处置：重新抓包提取（方法见 skill `apk-2api-reverse`），或从 app 的 frida hook 取实时值
- 建议：渠道配置里把 key/iv 做成**可热更新**（DB 配置项 / 环境变量），不要硬编码进二进制

---

## 产物 URL 域名（代理/白名单注意）

| 类型 | 域名 |
|---|---|
| t2i | `tempfile.aiquickdraw.com` |
| i2i | `cdn2.leansoft-ai.com` |
| 上传（如需预上传） | `nano-bananaa.hungnx.workers.dev`（Wasabi worker） |

若 new-api 有图片代理白名单，需要放行上述域名。
