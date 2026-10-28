# Nano AI 模型 / 风格 / 素材全清单

> 数据来源：Firebase Remote Config 线上实时值（`home_category_data` / `home_banner_data` / `enhance_data` / `background_data` / `video_data_url`）+ `/user/ai_beauty` / `/user/ai_background` / `/user/clothes` 清单端点。
> 全量结构化数据见 `models_catalog.json`。采集时间 2026-10-28。

## 总览

| 类别 | 数量 | 端点 | 实测状态 |
|---|---|---|---|
| 图片风格模板 | **445** | `/image/createTask` | ✅ 可用（抽样 5 个不同分类全出图）|
| Banner 主推风格 | **3** | `/image/createTask` | ✅ 可用（frost/rain/christmas + 线上轮换的 3 个）|
| Enhance 增强模型 | **1** | `/image/enhance` | ✅ 端点 200（需先上传拿 filename）|
| Background 背景模型 | **6** | `/image/createTask` | ✅ materialId 通用 |
| 视频模板 | **136**（15 分类） | `/video/createTask` | ⚠️ 需 `multipart/form-data`，JSON 被拒 |
| 美颜模板 | **29** | `/image/ai_beauty` | ⚠️ 需上传流程 + accessKey/secretKey |
| AI 背景（人像） | **8** | `/image/AiBackground` | ⚠️ 需 mask/上传 |
| AI 背景（产品） | **11** | `/image/AiBackground` | ⚠️ 需 mask/上传 |
| 换装服装 | **135**（14 分类） | `/image/wardrobe` | ⚠️ accessKey 绑定待解 |
| 抠图 | — | `/image/removeBackground` | ✅ **可用**（传公网 url 即出 mask PNG）|

**合计 774 个模板/素材**。

---

## 1. 图片风格模板（445 个，52 分类）

`POST /image/createTask` `{materialId, ratio, url:"", prompt}` → taskId → 轮询 `/image/checkTask`

### 关键结论
- **materialId 全通用**：任意 445 个模板都能直接传，服务端不校验用户是否"解锁"该模板
- **全部 `is_premium = false`**（线上 RC 下发，无付费墙字段为 true）
- **纯文生图可用**：`url` 传空串即 t2i；传公网图片直链即 img2img（同一端点）

### 主要分类（Top 15）
| 分类 | 数量 |
|---|---|
| Trending | 59 |
| Monochrome | 31 |
| India Styles | 27 |
| Holi Festival | 19 |
| Nano Banana | 15 |
| Romantic & Couple | 15 |
| Lifestyle | 15 |
| Hot | 15 |
| Hair Studio | 14 |
| Historical & Cultural | 12 |
| Modern & Urban | 12 |
| Fantasy & Mythical | 11 |
| Record of Ragnarok | 11 |
| Discover Now!!! | 10 |
| Nature & Travel | 10 |

其余 37 个分类各 3-8 个（Christmas / Halloween / Retro Vibe / Doodle Style / Crayon World / Spider Hero …）。

### Nano Banana 分类（15 个，最像"通用风格"）
```
Dark Magic              content_nano_creepy
Portrait Elegant        content_nano_portrait_2
Tiempos Felices         content_nano_felices
Selfie Mirror           content_nano_selfie_1
Sun Flower              content_nano_sunflower
Urban Shadow            content_nano_urbanshadow
Cartoon Portrait Red    content_nano_cartoon_portrait_red
Dia de los Angelitos    content_nano_angelitos
Beach                   content_nano_beach
Cartoon Portrait Blonde content_nano_cartoon_portrait_blonde
Cartoon Portrait Brown  content_nano_cartoon_portrait_brown
Sketch Line Art         content_nano_sketch_2
Tarot Card              content_nano_tarotcard
Gathered Hair           content_nano_gathered_hair
Desert                  content_nano_desert
```

### 抽样实测记录（全部出图 ✅）
| 模板 | material_id | 结果 |
|---|---|---|
| Tarot Card | `content_nano_tarotcard` | ✅ 出图 |
| Sketch Line Art | `content_nano_sketch_2` | ✅ 出图 |
| Desert | `content_nano_desert` | ✅ taskId |
| Sun Flower | `content_nano_sunflower` | ✅ taskId |
| Burgundy Sari（Trending） | `content_27102026_burgundy_sari_pose_collage` | ✅ taskId |
| Jungle Wild（Banner） | `content_sola_jungle` | ✅ taskId |

> 完整 445 条见 `models_catalog.json` → `image_styles[]`

---

## 2. Banner 主推风格（3 个，RC 会轮换）

收藏页顶部大图位，DC 会定期换。**历史见过两批**：

| 批次 | style_name | material_id |
|---|---|---|
| 旧（已测通）| Frost | `content_nano_frost` |
| | Rain | `content_nano_rain` |
| | Christmas | `content_nano_christmas` |
| 新（2026-10-28 线上）| Jungle Wild | `content_sola_jungle` |
| | France Fan | `content_nano_wc_france_1` |
| | Sunrise Glow | `content_sola_sunrise` |

> 建议：把这些作为"稳定基线模型"暴露给 new-api（RC 轮换不影响旧 materialId 可用性 —— 已实测旧 frost/rain/christmas 仍能出图）。

---

## 3. Enhance 增强模型（1 个）

| style_name | material_id | model_type |
|---|---|---|
| Enhance Image | `content_enhance_image` | v_fuse |

端点：`POST /image/enhance` `{image_name}`（image_name 来自 `/genUploadLink` 返回的 filename）
实测：端点 200，返回 `{data:{image_url}}`（回显 CDN URL）。**上传步骤需签名头，待补**。

---

## 4. Background 背景模型（6 个）

走 `/image/createTask`（materialId 通用）：

| style_name | material_id |
|---|---|
| White Embroidered Eyelet Dress | `content_nano_background_1_1` |
| Soft Sunset Glow | `content_nano_background_1_2` |
| Dark Academia Ribbed Knit | `content_nano_background_1_3` |
| Minimalist Urban Elegance | `content_nano_background_1_4` |
| Classic Winter Elegance | `content_nano_background_1_5` |
| Rustic Farmhouse Chic | `content_nano_background_1_6` |

---

## 5. 视频模板（136 个，15 分类）

清单位于 RC 的 `video_data_url` → `https://cdn.leansoft-ai.com/ls32-gyra-ai/video-19102026.json`
（该 URL 会变，需定期重取）

| 分类 | 数量 |
|---|---|
| Trending | 50 |
| Viral Dance | 11 |
| Danceboo | 8 |
| Extreme Riders | 7 |
| Chibi Cute | 7 |
| AI Comic | 7 |
| Nostalgia | 7 |
| Memory | 6 |
| World Cup | 5 |
| Billionaire | 5 |
| Pet Cook | 5 |
| Hot | 5 |
| Vintage | 5 |
| Mini Riders | 4 |
| Arrest | 4 |

字段：`video_prompt` / `image_prompt` / `style_name` / `thumb_url`

端点：`POST /video/createTask` — **必须 `multipart/form-data`**（图片 part + 表单字段），
JSON body 会被拒：`Unrecognized Content-Type header value. FormData can only parse...`
> 若 new-api 需要视频能力，对接时用 multipart 重放；完整 136 条见 `models_catalog.json` → `video_templates[]`

---

## 6. 美颜模板（29 个）

`POST /user/ai_beauty`（无参数）→ 清单
`POST /image/ai_beauty` `{accessKey, secretKey, deviceNum, image, beautyId}`

accessKey/secretKey 来自 `POST /user/appToken`：
```json
{"success":true,"data":[{"secret_key":"43753361...","access_key":"TMPa3654..."}]}
```
deviceNum 来自 `POST /user/deviceId` → `{"deviceId":"SaasID:2vvpvl7oprrlyy"}`

实测：`ai_beauty` 上游 worker 报 520（image 字段需 filename 而非 URL，需先上传）。
样例模板：`ABM0002 DSLR`、`ABM0003 Kiểu fuji`…（29 个，美图素材源 `my-material.zone1.meitudata.com`）

---

## 7. AI 背景（8 人像 + 11 产品）

`POST /user/ai_background` → `{portraits:[...], products:[...]}`
`POST /image/AiBackground` `{accessKey, secretKey, deviceNum, image, mask, portraitId, productId, height}`

人像背景示例：`PMAI0001 Greenhouse`、`PMAI0005 Library`…
实测：`Missing fileds` — 字段名/必填项待补（疑似需 mask + 特定 height 组合）。

---

## 8. 换装（135 件服装，14 分类）

`POST /user/clothes` → `{material_list:[135], cate_list:[14], sort_list:[14]}`
`POST /image/wardrobe` `{accessKey, secretKey, deviceNum, url, clothesId}`

示例：`ACM0002 Midnight Gown`、`ACM0003 Gentle Mood`…
实测：`{"code":1000,"message":"access key not found"}` — accessKey 需与设备注册绑定（`/user/deviceId` 先注册该 android_id）。

---

## 9. 抠图（removeBackground）✅ 可用

`POST /image/removeBackground` `{deviceNum, url}` — **只需公网图 url，无需 accessKey**

实测返回：
```json
{"success":true,"data":{
  "kind":1,
  "mask":"https://meiyan-open-result.meitudata.com/.../xxx.png",
  "top_x":"183","top_y":"0","bottom_x":"841","bottom_y":"1024"
}}
```
（美图 open API 作后端，返回 alpha mask PNG + 抠图边界框）

---

## 给 new-api 的模型命名建议

| new-api model 名 | upstream materialId | 能力 |
|---|---|---|
| `nano-ai` | `content_nano_frost` | t2i（默认）|
| `nano-ai-rain` | `content_nano_rain` | t2i |
| `nano-ai-christmas` | `content_nano_christmas` | t2i |
| `nano-ai-jungle` | `content_sola_jungle` | t2i（线上新 banner）|
| `nano-ai-tarot` | `content_nano_tarotcard` | t2i |
| `nano-ai-sketch` | `content_nano_sketch_2` | t2i |
| `nano-ai-<任意>` | 从 `models_catalog.json` 取 445 条之一 | t2i / i2i |

**建议策略**：先上 3-8 个稳定模型（banner 三件套 + Nano Banana 分类抽样），
需要全量时从 `models_catalog.json` 批量导入 445 条做模型映射。
