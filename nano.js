// Nano AI (leansoft) 协议参考实现 — 逆向自 v1.8.2 b82 (com.nano.art.ai.generator)
// 已端到端验证: t2i (frost/rain/christmas) + i2i，2026-10-28
const crypto = require('crypto');

const PKG = 'com.nano.art.ai.generator';

/**
 * 生成 X-Client-Auth token（有效期 60 秒）
 * 明文: "{gen_ts}||{pkg}||{gen_ts+60}" → AES-256-CBC-PKCS7 → base64
 * 硬规则: pkg 必须是 com.nano.art.ai.generator 且与 header app-id 一致
 */
function buildToken(aesKey, aesIv, pkg = PKG) {
  const key = Buffer.from(aesKey, 'utf8');
  const iv = Buffer.from(aesIv, 'utf8');
  if (key.length !== 32) throw new Error('aesKey must be 32 bytes');
  if (iv.length !== 16) throw new Error('aesIv must be 16 bytes');
  const now = Math.floor(Date.now() / 1000);
  const plaintext = Buffer.from(`${now}||${pkg}||${now + 60}`, 'utf8');
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([c.update(plaintext), c.final()]).toString('base64');
}

/** 构造完整请求头 */
function HEADERS(cfg, deviceId, userId) {
  return {
    'X-Client-Auth': buildToken(cfg.aesKey, cfg.aesIv),
    'device-id': deviceId,
    'app-user-id': userId || '',
    'app-version': '1.8.2',
    'version-code': '82',
    'language-code': 'en',
    'app-id': PKG,
    'os-type': 'android',
    'Content-Type': 'application/json',
    'User-Agent': 'okhttp/4.12.0',
  };
}

const EP = (base) => ({
  enrich:             `${base}/prompt/enrich`,
  genUploadLink:      `${base}/genUploadLink`,
  uploadImageV3:      `${base}/upload/image-v3`,
  imageToImage:       `${base}/image/img2img/v2`,
  imageToImagePrompt: `${base}/image/prompt`,
  imageCreateTask:    `${base}/image/createTask`,
  imageCheckTask:     `${base}/image/checkTask`,
  taskResult:         `${base}/task/result`,
  enhance:            `${base}/image/enhance`,
  retake:             `${base}/image/retake`,
  removeBg:           `${base}/image/removeBackground`,
  expand:             `${base}/image/expand`,
  wardrobe:           `${base}/image/wardrobe`,
  aiBeauty:           `${base}/image/ai_beauty`,
  aiBackground:       `${base}/image/AiBackground`,
  videoCreate:        `${base}/video/createTask`,
  videoCheck:         `${base}/video/checkTask`,
});

// 已验证风格模板
const STYLES = {
  frost: 'content_nano_frost',
  rain: 'content_nano_rain',
  christmas: 'content_nano_christmas',
};

// ratio 映射
const RATIO = {
  '1024x1024': '1:1', '1792x1024': '16:9', '1024x1792': '9:16', '768x1024': '3:4',
};

module.exports = { buildToken, HEADERS, EP, STYLES, RATIO, PKG };
