// 上游 HTTP 经 python curl_cffi（绕 Cloudflare TLS 指纹）
const { spawn } = require('child_process');
const path = require('path');

function upcall(url, headers, body) {
  return new Promise((resolve, reject) => {
    const p = spawn('python', [path.join(__dirname, 'client.py')]);
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', () => {
      try {
        const outer = JSON.parse(out);
        let parsed = outer.body;
        try { parsed = JSON.parse(outer.body); } catch {}
        resolve({ status: outer.status, body: parsed, raw: outer.body });
      } catch (e) { reject(new Error('client.py parse fail: ' + out.slice(0, 200) + err.slice(0, 200))); }
    });
    p.on('error', reject);
    p.stdin.write(JSON.stringify({ url, method: 'POST', headers, body }));
    p.stdin.end();
  });
}
module.exports = { upcall };
