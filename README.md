# nano-ai-APP-2api

> Nano AI v1.8.2 (leansoft / nano-banana) 逆向 2API — **端到端已验证出图**

![验证](https://img.shields.io/badge/status-verified-success) ![风格](https://img.shields.io/badge/styles-frost%2Brain%2Bchristmas-blue) ![i2i](https://img.shields.io/badge/i2i-working-green)

## ✅ 已验证能力

| 能力 | 状态 | 说明 |
|---|---|---|
| t2i 文生图 | ✅ | frost / rain / christmas 三风格全通，20-40s 出图 |
| i2i 图生图 | ✅ | createTask 带公网 `url` 即可，无需预上传 |
| 免登录 | ✅ | 匿名 device-id，无账号体系 |
| 配额 | ✅ | 同 device 连发 10 张 9 成功，无明显硬限频 |

## 🔐 协议核心

```
baseUrl     https://nano-banana.leansoft-ai.com
aesKey      dP8LmQ2zXw5KeHs9VrNaTc6YfBg4JuMi   (Firebase Remote Config 下发)
aesIv       F3qRwX7nKbV8mLpC
```

**X-Client-Auth 生成**（有效期 60 秒，每请求现算）：

```python
plaintext = f"{gen_ts}||com.nano.art.ai.generator||{gen_ts+60}"
token = base64( AES-256-CBC( key, iv, pkcs7(plaintext) ) )
```

**鉴权规则**（服务器硬校验，已实测）：
- token 明文中段包名 **必须** `com.nano.art.ai.generator`，且 == header `app-id`
- `device-id` 必填非空；错 key / 错包名 → `Decryption failed`

**请求头**：
```
X-Client-Auth / device-id / app-user-id(可空) / app-version=1.8.2
version-code=82 / app-id=com.nano.art.ai.generator / os-type=android
User-Agent: okhttp/4.12.0
```

## 🔗 链路

```
1. POST /image/createTask   {materialId, ratio, url, prompt}   → {taskId}
2. POST /image/checkTask    {taskId}                           → state: generating(50) → success
3. resultJson.resultUrls[0]                                    → PNG/JPG
```

风格 materialId：`content_nano_frost` / `content_nano_rain` / `content_nano_christmas`

## 🚀 运行

```bash
npm install express
pip install curl_cffi cryptography
node server.js        # :8907
```

- Demo 页：`http://localhost:8907/`
- OpenAI 兼容：
```bash
curl -X POST http://localhost:8907/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"model":"nano-ai","prompt":"cyberpunk cat","style":"frost"}'
```

## ⚠️ TLS 指纹注意（实测结论，精确版）

上游挂在 Cloudflare，**不同运行时的 TLS 指纹被接受程度不同**：

| 运行时 | 直连结果 |
|---|---|
| **Go 标准库 `net/http`** | ✅ **10/10 通过**（推荐，见 `go-client/nanoai.go`）|
| curl (schannel) | ✅ 通过 |
| python `curl_cffi` (chrome124) | ✅ 通过 |
| python `urllib` | ✅ 通过 |
| **Node.js (`fetch`/undici/https)** | ❌ `ECONNRESET` |
| python `requests` | ❌ 需 curl_cffi 替身 |

→ **Node 侧 server.js 必须经 `client.py`（curl_cffi）桥接**；Go 可直接标准库直连，无需代理/无需 utls。

## 📊 压测

| 并发 | 请求 | 成功率 | p50 |
|---|---|---|---|
| 4 | 8 | 75% | 30.5s |
| 8 | 16 | 87% | 39.9s |

失败项均为上游队列超时（120s 轮询上限），重试即成。

## 📁 文件

```
go-client/nanoai.go   ★ Go 纯协议参考实现（零依赖，可直接跑）
nano.js      协议层（token/端点/风格）
server.js    OpenAI 兼容 API + demo
client.py    TLS 伪装客户端（python, curl_cffi）
upcall.js    Node→Python 桥接
stress.js    压测
config.json  密钥配置
```

## 🎯 两个接入路径

| 路径 | 适用 | 说明 |
|---|---|---|
| **Go 直连**（推荐） | new-api 原生渠道 | `go-client/nanoai.go` 直接抄进 `relay/channel/nanoai/`，标准库即可，无代理无中间层 |
| Node 中转 | 快速验证/独立服务 | `server.js`（需 python+curl_cffi 桥接）|

## 样图

见 `test_out.png`（frost t2i）、`christmas.png`（christmas t2i）、`i2i_out.jpg`（frost→i2i）。

## License

MIT
