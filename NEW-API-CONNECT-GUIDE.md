# new-api 对接实操手册 — Nano AI 渠道（给对接会话用）

> 本文档是**操作手册**，照着做即可。参考实现 `go-client/nanoai.go`（已验证可跑）。
> 建议照抄现有渠道 `relay/channel/imagenai/`（211+306 行，同类 images 渠道）的目录结构。
> ⚠️ 先读 `CAPABILITIES.md` —— 本渠道是**风格模板驱动的图片生成器**，不是通用 t2i，也没有 t2v。

---

## 0. 前置信息卡（复制即用）

```
上游 BaseURL   https://nano-banana.leansoft-ai.com
鉴权方式       自定义头 X-Client-Auth（AES-256-CBC 现场加密，60s 有效）
建议渠道类型   新增自定义 type（参考 imagenai=67 → 建议取下一个可用号）
协议           createTask(异步) → checkTask(轮询) → resultUrls[0]
TLS 指纹       ✅ Go 标准库直连 10/10 通过，无需代理/utls
```

**密钥（可热更，勿硬编码）**：
```
aesKey = dP8LmQ2zXw5KeHs9VrNaTc6YfBg4JuMi   (32 bytes)
aesIv  = F3qRwX7nKbV8mLpC                    (16 bytes)
```

---

## 1. 鉴权头（核心，必须先实现）

### 算法
```
明文 = fmt.Sprintf("%d||%s||%d", now, "com.nano.art.ai.generator", now+60)
密文 = AES-256-CBC( key, iv ).Encrypt( PKCS7Pad(明文) )
token = base64.StdEncoding.EncodeToString(密文)
header: X-Client-Auth = token
```

### Go 实现（直接复制）
```go
package nanoai

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"fmt"
	"time"
)

const (
	appID  = "com.nano.art.ai.generator"
	// 做成渠道配置项或环境变量，支持热更
	defaultAESKey = "dP8LmQ2zXw5KeHs9VrNaTc6YfBg4JuMi"
	defaultAESIv  = "F3qRwX7nKbV8mLpC"
)

// buildToken 生成 X-Client-Auth（有效期 60s，每请求现算，禁止缓存）
func buildToken(aesKey, aesIv string) (string, error) {
	now := time.Now().Unix()
	plain := fmt.Sprintf("%d||%s||%d", now, appID, now+60)

	block, err := aes.NewCipher([]byte(aesKey))
	if err != nil {
		return "", err
	}
	bs := block.BlockSize()
	padLen := bs - len(plain)%bs
	padded := append([]byte(plain), bytes.Repeat([]byte{byte(padLen)}, padLen)...)
	out := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, []byte(aesIv)).CryptBlocks(out, padded)
	return base64.StdEncoding.EncodeToString(out), nil
}

// setupAuthHeader 在 SetupRequestHeader 里调用
func setupAuthHeader(req *http.Header, aesKey, aesIv, deviceID string) error {
	tok, err := buildToken(aesKey, aesIv)
	if err != nil {
		return err
	}
	req.Set("X-Client-Auth", tok)
	req.Set("device-id", deviceID)      // 必填非空！空 → Missing required headers
	req.Set("app-user-id", "")
	req.Set("app-version", "1.8.2")
	req.Set("version-code", "82")
	req.Set("language-code", "en")
	req.Set("app-id", appID)            // 必须与 token 明文一致，否则 Decryption failed
	req.Set("os-type", "android")
	req.Set("Content-Type", "application/json")
	req.Set("User-Agent", "okhttp/4.12.0")
	return nil
}
```

### device-id 策略
```go
// 按 new-api 用户 ID 派生，稳定且便于上游分桶
func deviceIDForUser(userID int) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("nanoai-%d", userID)))
	return hex.EncodeToString(h[:8]) // 16 字符 hex
}
```
或每请求随机（实测同 device 连发 10 张 9 成功，无硬限频）。

---

## 2. 渠道目录与注册

### 2.1 新建目录
```bash
mkdir -p relay/channel/nanoai
# 三个文件：
#   adaptor.go      —— 照抄 imagenai/adaptor.go 的骨架
#   do_request.go   —— 核心逻辑（见下）
#   adaptor_test.go —— 单测（照抄 imagenai 的）
```

### 2.2 注册（三处）
```go
// ① constant/channel.go —— 加渠道类型常量（取下一个空闲号，先确认最大值）
ChannelTypeNanoAI = <NEXT_FREE>

// ② constant/channel.go 的渠道名/BaseURL 表
"https://nano-banana.leansoft-ai.com",

// ③ relay/channel/adapter.go —— 在 GetAdaptor 的 switch 里加分支
case constant.ChannelTypeNanoAI:
    return &nanoai.Adaptor{}
```
> 精确改法照抄 `imagenai`（type 67）的所有出现位置：`grep -rn "imagenai" --include=*.go`

---

## 3. 核心请求逻辑（do_request.go）

### 3.1 DoRequest — 提交 + 同步轮询至终态
参考 `imagenai/do_request.go` 的「DoRequest 内收敛」模式（Simple/Jimeng 系都这样干）。

```go
func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	body, err := io.ReadAll(requestBody)
	if err != nil {
		return nil, err
	}
	prompt, imageURL := extractRequest(body) // 从 OpenAI images 请求体提取
	if strings.TrimSpace(prompt) == "" {
		return nil, fmt.Errorf("nanoai: no prompt")
	}

	materialID := materialIDFromModel(info.OriginModelName) // 见 §4 模型映射
	ratio := ratioFromSize(getSize(body))

	taskID, err := a.createTask(info, materialID, ratio, imageURL, prompt)
	if err != nil {
		return nil, err
	}
	// 轮询：3s × 40 次 = 120s
	return a.pollUntilDone(info, taskID)
}

func (a *Adaptor) createTask(info *relaycommon.RelayInfo, materialID, ratio, imageURL, prompt string) (string, error) {
	payload := map[string]string{
		"materialId": materialID,
		"ratio":      ratio,
		"url":        imageURL, // 空 → t2i；公网图链 → i2i
		"prompt":     prompt,
	}
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", a.baseURL+"/image/createTask", bytes.NewReader(b))
	if err := setupAuthHeader(&req.Header, a.aesKey, a.aesIv, a.deviceID(info)); err != nil {
		return "", err
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var r struct {
		Success bool `json:"success"`
		Data    struct {
			TaskID string `json:"taskId"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&r)
	if r.Data.TaskID == "" {
		return "", fmt.Errorf("nanoai: createTask no taskId (http=%d)", resp.StatusCode)
	}
	return r.Data.TaskID, nil
}

func (a *Adaptor) pollUntilDone(info *relaycommon.RelayInfo, taskID string) (any, error) {
	for i := 0; i < 40; i++ { // 3s × 40 = 120s
		time.Sleep(3 * time.Second)
		b, _ := json.Marshal(map[string]string{"taskId": taskID})
		req, _ := http.NewRequest("POST", a.baseURL+"/image/checkTask", bytes.NewReader(b))
		setupAuthHeader(&req.Header, a.aesKey, a.aesIv, a.deviceID(info))
		resp, err := a.client.Do(req)
		if err != nil {
			continue // 单次抖动不终止
		}
		var r struct {
			Data struct {
				State      string `json:"state"`
				Progress   int    `json:"progress"`
				ResultJSON string `json:"resultJson"`
			} `json:"data"`
		}
		json.NewDecoder(resp.Body).Decode(&r)
		resp.Body.Close()

		switch r.Data.State {
		case "success":
			var res struct{ ResultURLs []string `json:"resultUrls"` }
			if err := json.Unmarshal([]byte(r.Data.ResultJSON), &res); err == nil &&
				len(res.ResultURLs) > 0 && res.ResultURLs[0] != "" {
				return buildImagesResponse(res.ResultURLs[0]), nil
			}
			return nil, fmt.Errorf("nanoai: success but empty url")
		case "fail", "failed":
			return nil, fmt.Errorf("nanoai: task failed")
		}
	}
	return nil, fmt.Errorf("nanoai: timeout 120s (upstream queue stuck; retry usually succeeds)")
}
```

### 3.2 响应转换（OpenAI images 格式）
```go
func buildImagesResponse(url string) *dto.ImageResponse {
	return &dto.ImageResponse{
		Created: time.Now().Unix(),
		Data:    []dto.ImageData{{Url: url}},
	}
}
```
> 需要 `b64_json` 时在此处下载图片转 base64（图 1.0-1.6MB）。

### 3.3 其余 adaptor 方法
全部照抄 `imagenai`：
- `GetRequestURL` → 返回 createTask URL（或任意，因为 DoRequest 全接管）
- `ConvertImageRequest` → 透传或返回 nil
- `GetModelList` / `GetChannelName`

---

## 4. 模型映射（model → materialId）

```go
var modelToMaterial = map[string]string{
	"nano-ai-frost":     "content_nano_frost",
	"nano-ai-rain":      "content_nano_rain",
	"nano-ai-christmas": "content_nano_christmas",
	"nano-ai-jungle":    "content_sola_jungle",
	"nano-ai-tarot":     "content_nano_tarotcard",
	"nano-ai-sketch":    "content_nano_sketch_2",
	"nano-ai-desert":    "content_nano_desert",
	"nano-ai-sunflower": "content_nano_sunflower",
}

func materialIDFromModel(model string) string {
	if m, ok := modelToMaterial[model]; ok {
		return m
	}
	return "content_nano_frost" // 默认
}

func ratioFromSize(size string) string {
	switch size {
	case "1024x1024": return "1:1"
	case "1792x1024": return "16:9"
	case "1024x1792": return "9:16"
	case "768x1024":  return "3:4"
	}
	return "1:1"
}
```

**全量 445 个模板** 见 `models_catalog.json` → `image_styles[]`，
需要扩充时批量导入（`{style_name, material_id}` 直接映射）。

---

## 5. 渠道配置（后台填什么）

| 配置项 | 值 |
|---|---|
| 类型 | `Nano AI`（你新加的 type）|
| 名称 | `nano-ai-leansoft` |
| Base URL | `https://nano-banana.leansoft-ai.com`（代码里可硬编码，参考 imagenai 的 `uaForBase`）|
| 密钥 | 可留空，或填 `<aesKey>:<aesIv>`，代码里按需解析用于热更 |
| 模型 | 见 §4 列表；或 `nano-ai-*` 通配 |
| 分组/倍率 | 按你自己定价 |

---

## 6. 验证清单（对接完成后逐条过）

```bash
# ① 单次生图（约 20-40s）
curl -X POST http://<new-api>/v1/images/generations \
  -H "Authorization: Bearer <你的令牌>" \
  -H "Content-Type: application/json" \
  -d '{"model":"nano-ai-frost","prompt":"cyberpunk cat","n":1,"size":"1024x1024"}'
# 期望: {"data":[{"url":"https://tempfile.aiquickdraw.com/..."}]}

# ② 图生图
  -d '{"model":"nano-ai-frost","prompt":"make it anime","image":"https://公网图链"}'

# ③ 错误路径验证
#  - 空 prompt → 400
#  - 上游超时 → 明确错误信息（不是静默失败）
```

**回归重点**：
- [ ] token 每请求新算（不要缓存，60s 过期）
- [ ] `device-id` 非空
- [ ] `app-id` 与 token 明文一致
- [ ] 轮询失败重试一次（上游队列偶发卡 50%）
- [ ] 密钥走配置不硬编码

---

## 7. 已知坑（务必避开）

| 坑 | 现象 | 处理 |
|---|---|---|
| 缓存 token | 60s 后全部 `Invalid timestamp` | 每请求重算 |
| device-id 空 | `Missing required headers` | 必填 |
| app-id 乱填 | `Decryption failed` | 必须 `com.nano.art.ai.generator` |
| 上游队列卡 50% | 120s 超时 | **重试新任务**（不是失败）|
| 视频接口 | JSON 报 `Unrecognized Content-Type` | 必须 multipart；且**必须有图**（无 t2v）|
| 密钥轮换 | 突然全 `Decryption failed` | 重抓 key/iv（见 skill `apk-2api-reverse`）|
| 产物域名 | 图片 404 | 放行 `tempfile.aiquickdraw.com` / `cdn2.leansoft-ai.com` |

---

## 8. 密钥热更建议

aesKey/iv 来自 Firebase Remote Config，**上游可随时轮换**。

建议实现：
```go
// 渠道 key 字段存 "aesKey:aesIv"，解析失败则回落默认值
func parseKeys(channelKey string) (string, string) {
	if parts := strings.Split(channelKey, ":"); len(parts) == 2 &&
		len(parts[0]) == 32 && len(parts[1]) == 16 {
		return parts[0], parts[1]
	}
	return defaultAESKey, defaultAESIv
}
```
轮换时后台改渠道 key 即可，无需重新编译。
