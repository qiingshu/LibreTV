import { expect, it, vi } from 'vitest';
import http from 'node:http';
// Validate real safeLookup callback, then route the validated public address to OUR local fixture.
// This prevents this positive test from needing any public network access.
vi.mock('node:dns', async original => ({ ...await original<typeof import('node:dns')>(), lookup: (_h:unknown,_o:unknown,cb:(e:null,a:unknown[])=>void)=>cb(null,[{address:'8.8.8.8',family:4}]) }));
vi.mock('undici', async original => {
  const actual=await original<typeof import('undici')>();
  return {...actual,buildConnector:(options:Record<string,unknown>)=>actual.buildConnector({...options,lookup:((host: string, opts: unknown, cb: (err: Error | null, address?: unknown, family?: number) => void)=>{
    (options.lookup as (host: string, opts: unknown, cb: (err: Error | null) => void) => void)(host,opts,(err:Error|null)=>{
      if(err)return cb(err);
      return cb(null,opts && (opts as {all?:boolean}).all ? [{address:'127.0.0.1',family:4}] : '127.0.0.1',4);
    });
  }) as never})};
});
import { runWithSSRFProtection } from './ssrf';
it('strict public DNS lookup succeeds and delayed response remains readable after agent.close',async()=>{
  const server=http.createServer((_req,res)=>{res.write('first');setTimeout(()=>res.end('-last'),20);});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{
    const port=(server.address() as import('node:net').AddressInfo).port;
    const res=await runWithSSRFProtection({},()=>fetch(`http://public-fixture.invalid:${port}/`));
    expect(res.status).toBe(200);expect(await res.text()).toBe('first-last');
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
