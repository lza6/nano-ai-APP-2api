// Package nanoai — Nano AI (leansoft) 纯协议参考实现（Go 标准库，零依赖）
// 已实测：Go 标准库 TLS 直连上游 10/10 通过（Node/Python 会被 CF 拒，Go 不会）
// 用途：new-api 原生渠道 adaptor 的直接参考实现
package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	BaseURL = "https://nano-banana.leansoft-ai.com"
	AppKey  = "dP8LmQ2zXw5KeHs9VrNaTc6YfBg4JuMi" // 32B，Firebase RC 下发
	AppIv   = "F3qRwX7nKbV8mLpC"                 // 16B
	AppID   = "com.nano.art.ai.generator"
)

// StyleIDs 已验证风格模板
var StyleIDs = map[string]string{
	"nano-ai-frost":     "content_nano_frost",
	"nano-ai-rain":      "content_nano_rain",
	"nano-ai-christmas": "content_nano_christmas",
}

// RatioMap size → ratio
var RatioMap = map[string]string{
	"1024x1024": "1:1", "1792x1024": "16:9",
	"1024x1792": "9:16", "768x1024": "3:4",
}

// BuildToken 生成 X-Client-Auth（有效期 60s，每请求现算，禁止缓存）
// 明文: "{gen_ts}||{pkg}||{gen_ts+60}" → AES-256-CBC PKCS7 → base64
func BuildToken() (string, error) {
	now := time.Now().Unix()
	plain := fmt.Sprintf("%d||%s||%d", now, AppID, now+60)
	block, err := aes.NewCipher([]byte(AppKey))
	if err != nil {
		return "", err
	}
	bs := block.BlockSize()
	padLen := bs - len(plain)%bs
	padded := append([]byte(plain), bytes.Repeat([]byte{byte(padLen)}, padLen)...)
	out := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, []byte(AppIv)).CryptBlocks(out, padded)
	return base64.StdEncoding.EncodeToString(out), nil
}

func headers(deviceID string) (map[string]string, error) {
	tok, err := BuildToken()
	if err != nil {
		return nil, err
	}
	return map[string]string{
		"X-Client-Auth": tok,
		"device-id":     deviceID, // 必填非空；建议按 new-api 用户 hash 派生，便于上游风控分桶
		"app-user-id":   "",
		"app-version":   "1.8.2",
		"version-code":  "82",
		"language-code": "en",
		"app-id":        AppID, // 必须与 token 明文一致，否则 Decryption failed
		"os-type":       "android",
		"Content-Type":  "application/json",
		"User-Agent":    "okhttp/4.12.0",
	}, nil
}

func postJSON(path, deviceID string, body any, out any) (int, error) {
	hd, err := headers(deviceID)
	if err != nil {
		return 0, err
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", BaseURL+path, bytes.NewReader(b))
	if err != nil {
		return 0, err
	}
	for k, v := range hd {
		req.Header.Set(k, v)
	}
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if out != nil {
		_ = json.Unmarshal(raw, out)
	}
	return resp.StatusCode, nil
}

// CreateTask 提交生成任务，返回 taskId
func CreateTask(deviceID, prompt, styleKey, size string) (string, error) {
	mid := StyleIDs[styleKey]
	if mid == "" {
		mid = StyleIDs["nano-ai-frost"]
	}
	ratio := RatioMap[size]
	if ratio == "" {
		ratio = "1:1"
	}
	var r struct {
		Success bool `json:"success"`
		Data    struct {
			TaskID string `json:"taskId"`
		} `json:"data"`
	}
	if _, err := postJSON("/image/createTask", deviceID, map[string]string{
		"materialId": mid, "ratio": ratio, "url": "", "prompt": prompt,
	}, &r); err != nil {
		return "", err
	}
	if r.Data.TaskID == "" {
		return "", fmt.Errorf("createTask returned no taskId")
	}
	return r.Data.TaskID, nil
}

// CreateImageTask 图生图：图片给公网直链即可，无需预上传
func CreateImageTask(deviceID, prompt, imageURL, styleKey string) (string, error) {
	mid := StyleIDs[styleKey]
	if mid == "" {
		mid = StyleIDs["nano-ai-frost"]
	}
	var r struct {
		Data struct {
			TaskID string `json:"taskId"`
		} `json:"data"`
	}
	if _, err := postJSON("/image/createTask", deviceID, map[string]string{
		"materialId": mid, "ratio": "1:1", "url": imageURL, "prompt": prompt,
	}, &r); err != nil {
		return "", err
	}
	if r.Data.TaskID == "" {
		return "", fmt.Errorf("createTask(img2img) returned no taskId")
	}
	return r.Data.TaskID, nil
}

// WaitResult 轮询直到出图（3s 间隔，最多 40 次 = 120s）
// 上游偶发卡 generation 50%（队列问题），超时后调用方应重试新任务
func WaitResult(deviceID, taskID string) (string, error) {
	type ck struct {
		Success bool `json:"success"`
		Data    struct {
			State      string `json:"state"`
			Progress   int    `json:"progress"`
			ResultJSON string `json:"resultJson"`
		} `json:"data"`
	}
	for i := 0; i < 40; i++ {
		time.Sleep(3 * time.Second)
		var r ck
		if _, err := postJSON("/image/checkTask", deviceID, map[string]string{"taskId": taskID}, &r); err != nil {
			continue // 单次网络抖动不终止
		}
		switch r.Data.State {
		case "success":
			var res struct {
				ResultURLs []string `json:"resultUrls"`
			}
			if err := json.Unmarshal([]byte(r.Data.ResultJSON), &res); err == nil && len(res.ResultURLs) > 0 && res.ResultURLs[0] != "" {
				return res.ResultURLs[0], nil
			}
			return "", fmt.Errorf("success but no url: %s", r.Data.ResultJSON)
		case "fail", "failed":
			return "", fmt.Errorf("task failed: %+v", r.Data)
		}
	}
	return "", fmt.Errorf("timeout polling task %s", taskID)
}

// Generate 一站式：提交 + 轮询
func Generate(deviceID, prompt, styleKey, size string) (string, error) {
	tid, err := CreateTask(deviceID, prompt, styleKey, size)
	if err != nil {
		return "", err
	}
	return WaitResult(deviceID, tid)
}

func main() {
	url, err := Generate("ref_impl_device_01", "a robot in snowy forest", "nano-ai-frost", "1024x1024")
	if err != nil {
		fmt.Println("ERR:", err)
		return
	}
	fmt.Println("OK:", url)
}
