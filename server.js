// Nano AI 2API server — OpenAI 兼容 images API + demo 页（端到端已验证）
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HEADERS, EP, STYLES } = require('./nano');
const { upcall } = require('./upcall');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const app = express();
app.use(express.json({ limit: '20mb' }));

const DEMO_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>Nano AI 2API Demo</title>
<style>
body{font-family:system-ui;background:#0f1115;color:#eee;max-width:720px;margin:40px auto;padding:0 20px}
input,textarea,select{width:100%;padding:10px;margin:6px 0;background:#1a1d24;border:1px solid #333;color:#eee;border-radius:8px}
button{padding:10px 24px;background:#6c5ce7;color:#fff;border:0;border-radius:8px;cursor:pointer}
#out{margin-top:20px;padding:12px;background:#1a1d24;border-radius:8px;min-height:60px;white-space:pre-wrap}
img{max-width:100%;border-radius:8px;margin-top:12px}
.badge{display:inline-block;background:#6c5ce7;border-radius:4px;padding:2px 8px;font-size:12px;margin-bottom:12px}
</style></head><body>
<span class="badge">Nano AI v1.8.2 · leansoft 协议 · 已验证</span>
<h2>Nano AI 2API 演示</h2>
<textarea id="prompt" rows="3" placeholder="输入提示词">cyberpunk cat city neon</textarea>
<label>风格</label>
<select id="style"><option value="frost">Frost</option><option value="rain">Rain</option><option value="christmas">Christmas</option></select>
<button onclick="gen()">生成图片</button>
<div id="out">等待请求…</div>
<script>
async function gen(){
  const out=document.getElementById('out');
  out.textContent='请求中…（约20-40秒）';
  try{
    const r=await fetch('/v1/images/generations',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'nano-ai',prompt:document.getElementById('prompt').value,style:document.getElementById('style').value,n:1,size:'1024x1024'})});
    const j=await r.json();
    if(j.error){out.textContent='错误: '+JSON.stringify(j.error);return}
    const d=j.data?.[0];
    out.innerHTML=(d?.b64_json?('<img src="data:image/png;base64,'+d.b64_json+'">'):('<img src="'+(d?.url||'')+'">'))||JSON.stringify(j,null,2);
  }catch(e){out.textContent='异常: '+e.message}
}
</script></body></html>`;

app.get('/', (_q, r) => r.type('html').send(DEMO_HTML));
app.get('/v1/models', (_q, r) => r.json({ data: [{ id: 'nano-ai' }] }));

const jobs = new Map(); // taskId -> {status, url}

app.post('/v1/images/generations', async (req, res) => {
  const { prompt, n = 1, size = '1024x1024', style = 'frost' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: { message: 'prompt required' } });
  const materialId = STYLES[style] || STYLES.frost;
  try {
    const ep = EP(cfg.baseUrl);
    const deviceId = req.headers['x-device-id'] || crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const headers = HEADERS(cfg, deviceId);

    const cr = await upcall(ep.imageCreateTask, headers, JSON.stringify({ materialId, ratio: sizeToRatio(size), url: '', prompt }));
    const cj = typeof cr.body === 'object' ? cr.body : {};
    const taskId = cj?.data?.task_id || cj?.data?.taskId;
    if (!taskId) return res.status(502).json({ error: { message: 'createTask failed', upstream: cj } });

    let url = null, last = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(s => setTimeout(s, 3000));
      const kr = await upcall(ep.imageCheckTask, headers, JSON.stringify({ taskId }));
      const kj = typeof kr.body === 'object' ? kr.body : {};
      const d = kj?.data || {};
      last = d;
      if (d.state === 'success') {
        try { url = JSON.parse(d.resultJson || '{}').resultUrls?.[0]; } catch {}
        if (!url) url = d.url || d.image_url;
        break;
      }
      if (d.state === 'fail' || d.state === 'FAIL') return res.status(502).json({ error: { message: 'task failed', upstream: d } });
    }
    if (!url) return res.status(504).json({ error: { message: 'timeout polling task', last } });

    if (req.body.response_format === 'b64_json') {
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64');
      return res.json({ created: Date.now() / 1000 | 0, data: Array.from({ length: n }, () => ({ b64_json: buf })) });
    }
    res.json({ created: Date.now() / 1000 | 0, data: Array.from({ length: n }, () => ({ url })) });
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
});

function sizeToRatio(s) {
  const m = { '1024x1024': '1:1', '1792x1024': '16:9', '1024x1792': '9:16', '768x1024': '3:4' };
  return m[s] || '1:1';
}

const PORT = process.env.PORT || 8907;
app.listen(PORT, () => console.log(`[nano-2api] http://localhost:${PORT}/  upstream=${cfg.baseUrl}  key=${cfg.aesKey ? 'SET' : 'MISSING'}`));
