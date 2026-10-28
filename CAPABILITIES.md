# Nano AI 能力边界（重要 — 决定渠道定位）

> 实测结论，2026-10-28。**对接前必读**，避免把本渠道误当成通用文生图/文生视频。

## 一句话定位

**Nano AI = 445 个风格模板驱动的图片生成器（可自定义提示词），不是通用自由文生图，也没有文生视频。**

| 你以为的 | 实际是 |
|---|---|
| 通用 t2i（像 Midjourney/DALL·E 自由风格）| ❌ 不是。风格由 `materialId` 模板强约束，prompt 只能填补内容细节 |
| 文生视频 t2v（像 Sora 输入文字出视频）| ❌ **没有**。视频 136 模板全部是 i2v（图生视频 + 运镜模板），必须上传图片 |
| 风格化图片生成 | ✅ 就是这个。445 模板 + 自由 prompt |

---

## 一、图片：有 t2i，但是"模板 + prompt"模式

```json
POST /image/createTask
{"materialId":"content_nano_frost","ratio":"1:1","url":"","prompt":"a cyberpunk cat"}
```

- `url` 传空 → 走 t2i（文字起内容，模板定风格）
- `url` 传公网图链 → 走 i2i（图片起内容，模板定风格）
- `prompt` 自由写，但**最终画面风格被 materialId 锁死**

**实测证据**：同一个 prompt `"cyberpunk cat city neon"` 配 3 个不同 materialId，
产出的是"雪景三联人像"（frost）/ "雪夜圣诞客厅"（christmas）/ "雨天人像"（rain）——
模板决定性远大于 prompt。这不是 bug，是产品设计（模板生成器）。

**能做什么**：
- ✅ 用 445 个模板批量产出特定风格图片（人像风格化、节日主题、动漫、海报等）
- ✅ 用 prompt 微调内容主体（"换成一只猫"、"换成夜景"）
- ❌ 不能指定任意画风/构图导演级控制（像 SD 的 lora/controlnet 那样）

## 二、视频：只有 i2v，没有 t2v

```json
POST /video/createTask   ← 必须是 multipart/form-data
[image part] + video_prompt + prompt
```

**实测证据**：
- 无图 multipart → `{"success":false,"error":"error code: 1101"}`（Cloudflare Worker 崩，因缺 image part）
- 客户端代码 `videoCreateTask(@Part MultipartBody.Part part, ...)` —— 图片 part 是必需参数
- 136 模板中 48 个 `image_prompt` 为空，但那只是"不预置示例图"，仍要用户自己上传

**能做什么**：
- ✅ 上传一张图 + 选运镜模板 → 生成动态视频（跳舞、运镜、特效）
- ❌ 不能纯文字生成视频

## 三、其他能力（工具类）

| 能力 | 可用性 | 说明 |
|---|---|---|
| 抠图 removeBackground | ✅ 完全可用 | 传图片 url → 返回 alpha mask PNG（唯一免 key 工具）|
| 画质增强 enhance | ⚠️ 端点可用 | 需先上传拿 filename，上传签名头未破 |
| 美颜 ai_beauty (29) | ⚠️ 清单可用 | 需上传流程 |
| 换装 wardrobe (135) | ⚠️ 清单可用 | 需 deviceId 注册绑定（当前 `access key not found`）|
| AI 背景 (8+11) | ⚠️ 清单可用 | 字段待补（`Missing fileds`）|

---

## 对 new-api 渠道定位的建议

**推荐定位**：`风格化图片生成` 专用渠道（image generation, templated）

| 适合 | 不适合 |
|---|---|
| 用户需要特定风格皮肤（节日/婚礼/动漫/职业照） | 用户要求"随便描述一个场景出图" |
| 批量风格化已有照片（i2i） | 需要图生视频以外的时间线控制 |
| 抠图/换背景等工具类需求 | 替代 Sora/Veo 类视频模型 |

**模型命名建议**（暴露给用户时带风格语义，避免误解）：
```
nano-ai-frost        雪景人像
nano-ai-rain         雨夜人像
nano-ai-christmas    圣诞场景
nano-ai-tarot        塔罗卡牌风
nano-ai-sketch       线稿素描
nano-ai-jungle       丛林冒险
```
不要命名为 `nano-ai` 裸名让用户以为通用模型。
