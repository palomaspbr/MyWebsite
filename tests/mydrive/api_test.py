"""MyDrive API test against `wrangler dev` (Worker + MyDriveStore Durable Object).
    wrangler dev --port 8797 --ip 127.0.0.1 --local --var MYDRIVE_PASSWORD:test-pw-123
    python tests/mydrive/api_test.py [http://127.0.0.1:8797] [password]
Runs the brute-force check last (it locks this IP out for 15 minutes on that local state)."""
import hashlib, json as _json, os, sys, urllib.request, urllib.error


class _Resp:
    def __init__(self, status, headers, content):
        self.status_code, self.headers, self.content = status, headers, content
        self.text = content.decode('utf-8', 'replace')

    def json(self):
        return _json.loads(self.content)


class _Cookies(dict):
    def set(self, name, value, path='/'):
        self[name] = value


class Session:
    """Tiny stand-in for requests.Session (no third-party packages needed)."""
    def __init__(self):
        self.cookies = _Cookies()

    def request(self, method, url, json=None, data=None, headers=None):
        h = dict(headers or {})
        body = data
        if json is not None:
            body = _json.dumps(json).encode()
            h['Content-Type'] = 'application/json'
        if self.cookies:
            h['Cookie'] = '; '.join(f'{k}={v}' for k, v in self.cookies.items())
        req = urllib.request.Request(url, data=body, method=method, headers=h)
        try:
            res = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            res = e
        content = res.read()
        for sc in res.headers.get_all('Set-Cookie') or []:
            k, _, rest = sc.partition('=')
            v = rest.split(';')[0]
            if 'Max-Age=0' in sc:
                self.cookies.pop(k, None)
            else:
                self.cookies[k] = v
        return _Resp(res.status, res.headers, content)

    def get(self, url, **kw): return self.request('GET', url, **kw)
    def post(self, url, **kw): return self.request('POST', url, **kw)
    def put(self, url, **kw): return self.request('PUT', url, **kw)
    def delete(self, url, **kw): return self.request('DELETE', url, **kw)


class requests:  # noqa: N801  (keeps the test readable)
    Session = Session

    @staticmethod
    def post(url, **kw): return Session().post(url, **kw)

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8797') + '/mydrive/api'
PW = sys.argv[2] if len(sys.argv) > 2 else 'test-pw-123'
H = {'X-MyDrive': '1'}
results = []


def check(name, cond, extra=''):
    results.append(bool(cond))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))


s = requests.Session()
r = s.get(BASE + '/me'); check('me without login -> 401', r.status_code == 401, r.text)
r = s.get(BASE + '/files'); check('files without login -> 401', r.status_code == 401, r.text)
r = s.post(BASE + '/login', json={'user': 'Paloma', 'password': PW}); check('login without X-MyDrive -> 403', r.status_code == 403, r.text)
r = s.post(BASE + '/login', json={'user': 'Paloma', 'password': PW}, headers={**H, 'Origin': 'https://evil.example'})
check('login from another origin -> 403', r.status_code == 403, r.text)
r = s.post(BASE + '/login', json={'user': 'Paloma', 'password': 'nope'}, headers=H)
check('wrong password -> 401 wrong_login', r.status_code == 401 and r.json().get('error') == 'wrong_login', r.text)
r = s.post(BASE + '/login', json={'user': 'Someone', 'password': PW}, headers=H)
check('wrong user -> 401', r.status_code == 401, r.text)
r = s.post(BASE + '/login', json={'user': 'paloma', 'password': PW}, headers=H)
check('login (user any case) -> 200', r.status_code == 200, r.text)
sc = r.headers.get('Set-Cookie', '')
check('cookie HttpOnly + SameSite + Path', 'HttpOnly' in sc and 'SameSite=Lax' in sc and 'Path=/mydrive' in sc, sc)
r = s.get(BASE + '/me'); check('me after login -> 200', r.status_code == 200, r.text)

r = s.get(BASE + '/files'); check('empty list', r.status_code == 200 and r.json()['files'] == [], r.text)
limit = r.json()['limit']


def upload(name, data, typ='application/octet-stream'):
    r = s.post(BASE + '/files', json={'name': name, 'size': len(data), 'type': typ}, headers=H)
    assert r.status_code == 201, r.text
    fid, part = r.json()['id'], r.json()['part']
    n = max(1, -(-len(data) // part))
    for i in range(n):
        rr = s.put(f'{BASE}/files/{fid}/parts/{i}', data=data[i * part:(i + 1) * part], headers=H)
        assert rr.status_code == 200, rr.text
    rr = s.post(f'{BASE}/files/{fid}/done', headers=H)
    return fid, rr


big = os.urandom(20 * 1024 * 1024 + 3)
fid, rr = upload('Fotô de ação 2026.bin', big, 'image/jpeg')
check('upload 20 MiB + 3 B in 3 parts', rr.status_code == 200, rr.text)
r = s.get(BASE + '/files'); lst = r.json()
check('list shows it with size + used', len(lst['files']) == 1 and lst['files'][0]['size'] == len(big) and lst['used'] == len(big), r.text)
r = s.get(f'{BASE}/files/{fid}/download')
check('download is byte-for-byte identical', hashlib.sha256(r.content).digest() == hashlib.sha256(big).digest(), f'{len(r.content)} vs {len(big)}')
check('Content-Length', r.headers.get('Content-Length') == str(len(big)), r.headers.get('Content-Length'))
cd = r.headers.get('Content-Disposition', '')
check('Content-Disposition attachment with UTF-8 name', cd.startswith('attachment;') and "filename*=UTF-8''Fot%C3%B4%20de%20a%C3%A7%C3%A3o%202026.bin" in cd, cd)
check('nosniff + sandbox CSP', r.headers.get('X-Content-Type-Options') == 'nosniff' and 'sandbox' in r.headers.get('Content-Security-Policy', ''))
r = s.get(f'{BASE}/files/{fid}/download', headers={'Range': 'bytes=1048570-1048590'})
check('Range across a chunk boundary -> 206', r.status_code == 206 and r.content == big[1048570:1048591] and r.headers.get('Content-Range') == f'bytes 1048570-1048590/{len(big)}', r.status_code)
r = s.get(f'{BASE}/files/{fid}/download', headers={'Range': 'bytes=-5'})
check('suffix Range', r.status_code == 206 and r.content == big[-5:])
r = s.get(f'{BASE}/files/{fid}/download', headers={'Range': f'bytes={len(big) - 10}-'})
check('open-ended Range', r.status_code == 206 and r.content == big[-10:])
r = s.get(f'{BASE}/files/{fid}/download', headers={'Range': f'bytes={len(big) + 5}-'})
check('Range past the end -> 416', r.status_code == 416)

fid0, rr = upload('vazio.txt', b'', 'text/plain')
check('empty file upload', rr.status_code == 200, rr.text)
r = s.get(f'{BASE}/files/{fid0}/download'); check('empty file download', r.status_code == 200 and r.content == b'', r.status_code)

small = 'olá mundo\n'.encode()
fid1, rr = upload('notas.txt', small, 'text/plain')
r = s.get(f'{BASE}/files/{fid1}/download'); check('small file round trip', r.content == small)

r = s.post(BASE + '/files', json={'name': 'parcial.bin', 'size': 3 * 1024 * 1024, 'type': ''}, headers=H)
pid = r.json()['id']
r = s.put(f'{BASE}/files/{pid}/parts/0', data=b'x' * 100, headers=H); check('wrong part length -> 400', r.status_code == 400, r.text)
r = s.post(f'{BASE}/files/{pid}/done', headers=H); check('done before all bytes -> 409', r.status_code == 409, r.text)
r = s.get(BASE + '/files'); check('unfinished upload not listed', all(f['id'] != pid for f in r.json()['files']))
r = s.get(f'{BASE}/files/{pid}/download'); check('unfinished upload not downloadable', r.status_code == 404)
r = s.delete(f'{BASE}/files/{pid}', headers=H); check('delete unfinished', r.status_code == 200)

r = s.post(BASE + '/files', json={'name': 'gigante.bin', 'size': limit + 1, 'type': ''}, headers=H)
check('over the limit -> 413 drive_full', r.status_code == 413 and r.json()['error'] == 'drive_full', r.text)
r = s.post(BASE + '/files', json={'name': 'x', 'size': -1}, headers=H); check('negative size -> 400', r.status_code == 400)
r = s.delete(f'{BASE}/files/{fid1}'); check('DELETE without X-MyDrive -> 403', r.status_code == 403)
r = s.get(f'{BASE}/files/AAAAAAAAAAAAAAAAAAAAAA/download'); check('unknown id -> 404', r.status_code == 404)

r = s.delete(f'{BASE}/files/{fid1}', headers=H); check('delete one', r.status_code == 200)
r = s.get(BASE + '/files'); check('2 files left', len(r.json()['files']) == 2, r.text)
r = s.post(BASE + '/delete-all', json={}, headers=H); check('delete-all needs confirm', r.status_code == 400)
r = s.post(BASE + '/delete-all', json={'confirm': True}, headers=H); check('delete-all', r.status_code == 200 and r.json()['deleted'] == 2, r.text)
r = s.get(BASE + '/files'); check('empty after delete-all, used 0', r.json()['files'] == [] and r.json()['used'] == 0, r.text)

other = requests.Session()
r = other.get(BASE + '/files'); check('another browser without cookie -> 401', r.status_code == 401)
other.cookies.set('md_session', 'forged-token-value', path='/mydrive')
r = other.get(BASE + '/files'); check('forged cookie -> 401', r.status_code == 401)

r = s.post(BASE + '/logout', headers=H); check('logout', r.status_code == 200)
r = s.get(BASE + '/me'); check('me after logout -> 401', r.status_code == 401)

codes = [requests.post(BASE + '/login', json={'user': 'Paloma', 'password': f'bad{i}'}, headers=H).status_code for i in range(6)]
check('brute force: locked after 5 wrong tries', codes[-1] == 429, codes)
r = requests.post(BASE + '/login', json={'user': 'Paloma', 'password': PW}, headers=H)
check('even the right password waits while locked', r.status_code == 429, r.status_code)

print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
