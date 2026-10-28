# TLS 指纹伪装客户端: stdin: JSON {url, headers, body} → stdout: JSON {status, body}
import sys, json
from curl_cffi import requests
req = json.loads(sys.stdin.read())
try:
    r = requests.request(req.get('method','POST'), req['url'], headers=req.get('headers',{}),
                         data=req.get('body'), impersonate='chrome124', verify=False, timeout=60)
    print(json.dumps({'status': r.status_code, 'body': r.text}))
except Exception as e:
    print(json.dumps({'status': 0, 'body': str(e)}))
