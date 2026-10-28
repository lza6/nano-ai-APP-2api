// 轻量压测: node stress.js [并发] [请求数]
const crypto = require('crypto');
const BASE = 'http://localhost:' + (process.env.PORT || 8907);

const cfg = require('./config.json');

async function one(i) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/v1/images/generations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-device-id': crypto.randomUUID().replace(/-/g, '').slice(0, 16) },
      body: JSON.stringify({ model: 'nano-ai', prompt: `stress test image ${i}` }),
    });
    const ms = Date.now() - t0;
    if (r.status === 503) return { s: 'skip', ms }; // key/iv 未配置
    return { s: r.ok ? 'ok' : 'http' + r.status, ms };
  } catch (e) { return { s: 'err:' + e.message.slice(0, 40), ms: Date.now() - t0 }; }
}

(async () => {
  const CC = parseInt(process.argv[2] || '10'), N = parseInt(process.argv[3] || '30');
  console.log(`压测 R1: 并发=${CC} 总请求=${N}`);
  const results = [];
  const batches = Math.ceil(N / CC);
  for (let b = 0; b < batches; b++) {
    const jobs = Array.from({ length: Math.min(CC, N - b * CC) }, (_, k) => one(b * CC + k));
    results.push(...await Promise.all(jobs));
    process.stdout.write(`\r${results.length}/${N}`);
  }
  console.log('');
  const byS = {};
  results.forEach(r => byS[r.s] = (byS[r.s] || 0) + 1);
  const okMs = results.filter(r => r.s === 'ok').map(r => r.ms).sort((a, b) => a - b);
  const pct = p => okMs.length ? okMs[Math.floor(okMs.length * p / 100)] + 'ms' : '-';
  console.log('状态分布:', byS);
  console.log(`延迟 p50=${pct(50)} p90=${pct(90)} p99=${pct(99)}`);
  if (Object.keys(byS).length === 1 && byS.skip) console.log('⚠️ aes_key/aes_iv 未配置 — 全部 skip，先完成真机提取');
})();
