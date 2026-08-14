"""Drive the dsh-mobile Android WebView through CDP: fill the launcher and
connect to the LAN host through dsh-remote, then report where the WebView
lands.

Usage:
  python scripts/cdp-android-e2e.py token <host:port> <token>
  python scripts/cdp-android-e2e.py pair  <host:port> <6-digit-code>
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
    mode, server, secret = sys.argv[1], sys.argv[2], sys.argv[3]
    targets = json.load(urllib.request.urlopen(f'{BASE}/json/list'))
    page = next(t for t in targets if t['type'] == 'page')
    ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)

    start_url = evaluate(ws, 'location.href')
    if mode == 'pair':
        fill = f'''
          document.getElementById('tabPair').click();
          document.getElementById('pairServer').value = {json.dumps(server)};
          document.getElementById('code').value = {json.dumps(secret)};
          document.getElementById('pairForm').requestSubmit();
          'submitted-pair'
        '''
    else:
        fill = f'''
          document.getElementById('tabToken').click();
          document.getElementById('server').value = {json.dumps(server)};
          document.getElementById('token').value = {json.dumps(secret)};
          document.getElementById('tokenForm').requestSubmit();
          'submitted-token'
        '''
    evaluate(ws, fill)
    # The launcher health-checks /healthz, then (pair mode) redeems the code,
    # then navigates to ?token=... which 302s into the session.
    time.sleep(10)
    landed = evaluate(ws, 'location.href')
    title = evaluate(ws, 'document.title')
    body_hint = evaluate(ws, 'document.body ? document.body.innerText.slice(0, 200) : ""')
    ws.close()
    print(json.dumps({
        'mode': mode,
        'start_url': start_url,
        'landed_url': landed,
        'title': title,
        'body_hint': body_hint,
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
