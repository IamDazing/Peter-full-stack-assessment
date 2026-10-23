"""Optional real HTTP smoke test. Requires free ports 8000/5173, macOS/Linux."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[1]
if os.name != 'posix':
    sys.exit('This optional HTTP smoke script supports macOS/Linux. Use scripts/check.py and the manual browser checklist on Windows.')

def request(path, body=None, key=None):
    headers = {'Content-Type': 'application/json'}
    if key: headers['Idempotency-Key'] = key
    req = urllib.request.Request('http://127.0.0.1:5173' + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=3)
    except urllib.error.HTTPError as response:
        return response.code, response.headers, response.read()
    with response:
        return response.status, response.headers, response.read()

# Refuse to send mutation checks to an unrelated service already using a port.
for port in (8000, 5173):
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(('127.0.0.1', port))
        except OSError:
            sys.exit(f'Port {port} is already in use. Stop the existing service before running smoke checks.')

with tempfile.TemporaryDirectory(prefix='assessment-smoke-') as scratch:
    env = dict(os.environ, APP_DB_PATH=str(Path(scratch) / 'smoke.sqlite3'))
    log = open(Path(scratch) / 'services.log', 'w+')
    proc = subprocess.Popen([sys.executable, 'scripts/dev.py'], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        for _ in range(150):
            if proc.poll() is not None: raise RuntimeError('launcher exited')
            try:
                status, _, body = request('/api/products/everyday-tee')
                if status == 200: break
            except (OSError, urllib.error.URLError): pass
            time.sleep(.2)
        else: raise RuntimeError('startup timeout')
        product = json.loads(body)
        assert len(product['skus']) == 8
        assert request('/')[0] == 200
        assert b'/src/main.tsx' in request('/')[2]
        assert request('/src/main.tsx')[0] == 200
        for sku in product['skus']:
            status, headers, body = request(sku['image'])
            assert status == 200 and b'<svg' in body
        payload={'sku_id':'forest-m','quantity':1}
        first=request('/api/cart/items',payload,'smoke-key')
        second=request('/api/cart/items',payload,'smoke-key')
        assert first[0] == second[0] == 201 and first[2] == second[2]
        assert second[1]['Idempotency-Replayed'] == 'true'
        assert request('/api/cart/items',payload,'new-key')[0] == 409
        assert json.loads(request('/api/cart')[2])['total_item_count'] == 1
        print('HTTP smoke PASS: documented launcher, frontend, transformed entry, all 8 local images, API proxy, add/replay/stock rejection, cart total.')
    except BaseException:
        log.seek(0);print(log.read());raise
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGINT)
        try: proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL);proc.wait()
        log.close()
