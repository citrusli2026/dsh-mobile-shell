"""Drive the dsh-mobile Android WebView through CDP: fill the launcher form,
connect to the LAN host through dsh-remote, and report where the WebView lands.

Usage: python mobile/scripts/cdp-android-e2e.py <host:port> <token>
Requires: adb forward tcp:9222 already established for the app's WebView.
"""
import json
import sys
import time
import urllib.request

import websocket

BASE = 'http://127.0.0.1:9222'


def evaluate(ws, expr):
    ws.send(json.dumps({
        'id': 1,
        'method': 'Runtime.evaluate',
        'params': {'expression': expr, 'returnByValue': True},
    }))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == 1:
            result = msg.get('result', {})
            if 'exceptionDetails' in result:
                raise RuntimeError(json.dumps(result['exceptionDetails'])[:300])
            return result.get('result', {}).get('value')


def main():
    server, token = sys.argv[1], sys.argv[2]
    targets = json.load(urllib.request.urlopen(f'{BASE}/json/list'))
    page = next(t for t in targets if t['type'] == 'page')
    ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)

    start_url = evaluate(ws, 'location.href')
    evaluate(ws, f'''
      document.getElementById('server').value = {json.dumps(server)};
      document.getElementById('token').value = {json.dumps(token)};
      document.getElementById('form').requestSubmit();
      'submitted'
    ''')
    # The launcher health-checks /healthz, then navigates to ?token=...
    time.sleep(8)
    landed = evaluate(ws, 'location.href')
    title = evaluate(ws, 'document.title')
    body_hint = evaluate(ws, 'document.body ? document.body.innerText.slice(0, 200) : ""')
    ws.close()
    print(json.dumps({
        'start_url': start_url,
        'landed_url': landed,
        'title': title,
        'body_hint': body_hint,
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
