import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import dns from 'node:dns/promises';
import { lookup } from 'node:dns';
vi.mock('node:dns', async (original) => {
  const actual = await original<typeof import('node:dns')>();
  return { ...actual, lookup: vi.fn(actual.lookup) };
});
import { runWithSSRFProtection } from './ssrf';
import { fetchUpstream, fetchWithSafeRedirects } from './fetch-utils';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function fixture(fn: (url: string, hits: string[]) => Promise<void>) {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url!);
    if (req.url === '/redirect') { res.writeHead(302, { location: '/stream' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'video/mp2t' });
    res.write('first-'); setTimeout(() => res.end('last'), 30);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, hits); }
  finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
describe('isolated connection and exemption regression', () => {
  it.each(['127.0.0.1','10.0.0.1','192.168.0.1','172.16.0.1','169.254.169.254','[::1]','[fd00::1]','[fe80::1]','[fe90::1]','[febf::1]','100.127.255.1','0.1.2.3','224.0.0.1','[0:0:0:0:0:0:0:1]','[::ffff:127.0.0.1]'])('blocks literal %s before a socket', async host => {
    await expect(runWithSSRFProtection({}, () => fetch(`http://${host}:18099/`))).rejects.toMatchObject({ cause: { code: 'ERR_SSRF_BLOCKED' } });
  });
  it('detects rebinding between public preflight and private connection DNS', async () => {
    await fixture(async (url, hits) => {
      vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
      vi.mocked(lookup).mockImplementation(((_host: unknown, _opts: unknown, cb: (err: null, addresses: unknown[]) => void) => cb(null, [{ address: '127.0.0.1', family: 4 }])) as never);
      await expect(fetchUpstream(url.replace('127.0.0.1', 'rebind.invalid'))).rejects.toThrow(/连接目标被拒绝/);
      expect(hits).toEqual([]);
    });
  });
  it.each(['', '0', 'false', 'true'])('LIVE flag %j does not enable a private connection exemption', async flag => {
    vi.stubEnv('LIVE_ALLOW_PRIVATE', flag);
    await fixture(async (url, hits) => {
      await expect(runWithSSRFProtection({ allowPrivate: true }, () => fetch(url))).rejects.toMatchObject({ cause: { code: 'ERR_SSRF_BLOCKED' } });
      await expect(fetchUpstream(url, { allowPrivate: true, safeRedirects: false })).rejects.toThrow(/连接目标被拒绝/);
      expect(hits).toEqual([]);
    });
  });
  it('live exception supports redirect and delayed stream; strict requests cannot reuse its pool', async () => {
    vi.stubEnv('LIVE_ALLOW_PRIVATE', '1');
    await fixture(async (url, hits) => {
      const { res, finalUrl } = await fetchWithSafeRedirects(url + '/redirect', {}, { allowPrivate: true });
      expect(finalUrl).toBe(url + '/stream'); expect(await res.text()).toBe('first-last');
      await expect(runWithSSRFProtection({}, () => fetch(url + '/normal'))).rejects.toMatchObject({ cause: { code: 'ERR_SSRF_BLOCKED' } });
      await expect(fetchUpstream(url + '/normal')).rejects.toThrow(/跳转目标被拒绝/);
      expect(hits).toEqual(['/redirect', '/stream']);
    });
  });
  it('mixed public/private DNS answer is rejected even when public answer is first', async () => {
    vi.mocked(lookup).mockImplementation(((_host: unknown, _opts: unknown, cb: (err: null, addresses: unknown[]) => void) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '::1', family: 6 }])) as never);
    await expect(runWithSSRFProtection({}, () => fetch('http://mixed.invalid/'))).rejects.toMatchObject({ cause: { code: 'ERR_SSRF_BLOCKED' } });
  });
});

// A server-controlled redirect can stream forever; following it must not leak a socket.
it('cancels an infinite 302 body and keeps final delayed body readable', async () => {
  vi.stubEnv('LIVE_ALLOW_PRIVATE', '1');
  let redirectClosed = false;
  let closeResolve: () => void = () => {};
  const closed = new Promise<void>(r => { closeResolve = r; });
  const server = http.createServer((req, res) => {
    if (req.url === '/infinite') {
      res.writeHead(302, { location: '/final' }); res.write('never-ending-redirect');
      const timer = setInterval(() => res.write('more'), 10);
      res.on('close', () => { clearInterval(timer); redirectClosed = true; closeResolve(); });
    } else {
      res.writeHead(200); res.write('first-'); setTimeout(() => res.end('last'), 30);
    }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    const {res} = await fetchWithSafeRedirects(`http://127.0.0.1:${port}/infinite`, {}, {allowPrivate:true});
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(Error('redirect connection not released')), 500))]);
    expect(redirectClosed).toBe(true);
    expect(await res.text()).toBe('first-last');
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
