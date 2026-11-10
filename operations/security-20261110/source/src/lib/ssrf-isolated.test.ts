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
  it('LIVE flag absent does not turn live intent into a connection exemption', async () => {
    vi.stubEnv('LIVE_ALLOW_PRIVATE', '');
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
