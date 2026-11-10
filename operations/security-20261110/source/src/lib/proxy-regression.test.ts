import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST, GET, DELETE } from '../app/api/auth/route';
import { handleProxyRequest, handleLiveStreamRequest } from './proxy-handlers';
vi.mock('./ssrf', async original => ({ ...await original<typeof import('./ssrf')>(), isBlockedByDNS: vi.fn(async () => false) }));
let cookie = '';
beforeEach(async () => {
  vi.stubEnv('PASSWORD', 'isolated-password'); vi.stubEnv('LIVE_ALLOW_PRIVATE', '1');
  const login = await POST(new Request('http://fixture/api/auth', { method:'POST', body:JSON.stringify({password:'isolated-password'}) }));
  expect(login.status).toBe(200); cookie=login.headers.get('set-cookie')!.split(';')[0];
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = (authenticated=true) => new Request('http://fixture/api/proxy', {headers:authenticated?{cookie,range:'bytes=0-15'}:{}});
it('login, session, incorrect password and logout contracts', async () => {
  expect((await (await GET(request())).json()).verified).toBe(true);
  expect((await (await GET(request(false))).json()).verified).toBe(false);
  expect((await POST(new Request('http://fixture/api/auth',{method:'POST',body:JSON.stringify({password:'wrong'})}))).status).toBe(401);
  expect((await DELETE()).headers.get('set-cookie')).toContain('Max-Age=0');
});
it('normal proxy rejects private targets even with live exemption enabled', async () => {
  const fn=vi.fn(); vi.stubGlobal('fetch',fn);
  expect((await handleProxyRequest(request(),'http://127.0.0.1/video.ts')).status).toBe(400);
  expect(fn).not.toHaveBeenCalled();
});
it('proxy preserves auth, range and delayed body reading', async () => {
  expect((await handleProxyRequest(request(false),'https://8.8.8.8/video.ts')).status).toBe(401);
  const upstream=vi.fn(async (_url:unknown, init?:RequestInit) => {
    expect((init!.headers as Record<string,string>).Range).toBe('bytes=0-15');
    return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('part1'));setTimeout(()=>{c.enqueue(new TextEncoder().encode('part2'));c.close();},20);}}),{status:206,headers:{'content-type':'video/mp2t','content-range':'bytes 0-9/10'}});
  }); vi.stubGlobal('fetch',upstream);
  const res=await handleProxyRequest(request(),'https://8.8.8.8/video.ts');
  expect(res.status).toBe(206); expect(await res.text()).toBe('part1part2'); expect(upstream).toHaveBeenCalledOnce();
});
it('manifest playback rewrites segments, encryption key and map through normal proxy', async () => {
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nseg.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}})));
  const res=await handleProxyRequest(request(),'https://8.8.8.8/a/index.m3u8'); const body=await res.text();
  expect(res.status).toBe(200);expect(body).toContain('/api/proxy?url=');expect(body).toContain('key.bin');expect(body).toContain('seg.ts');
});
it('live route retains authentication and explicit live-only exception', async () => {
  expect((await handleLiveStreamRequest(request(false),'http://127.0.0.1/live.ts')).status).toBe(401);
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('fixture-live',{headers:{'content-type':'video/mp2t'}})));
  const res=await handleLiveStreamRequest(request(),'http://127.0.0.1/live.ts');expect(res.status).toBe(200);expect(await res.text()).toBe('fixture-live');
});
