import urllib.request,urllib.parse,http.cookiejar,ssl,json,hashlib,pathlib
base='https://127.0.0.1:28443';ctx=ssl.create_default_context(cafile='A/revision/candidate.crt')
jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),urllib.request.HTTPSHandler(context=ctx));out=[]
def request(path,data=None,headers=None):
 req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json',**(headers or {})});return opener.open(req,timeout=45)
def check(name,ok,**details):
 out.append({'name':name,'passed':bool(ok),**details});assert ok,(name,details)
r=request('/api/auth',{'password':'candidate-review-fixture-only'});check('candidate HTTPS login',r.status==200,certificate_validation='trusted candidate certificate; hostname verified');r.close()
status=json.load(request('/api/status'));check('session verified',status['verified'] is True)
sources=status['defaultSources'];assert sources
source=sources[0];api='/api/detail?'+urllib.parse.urlencode({'id':'6573','source':json.dumps(source)})
detail=json.load(request(api));check('HTTPS source detail',len(detail.get('episodes',[]))>0,source_host=urllib.parse.urlsplit(source['url']).hostname)
media=detail['episodes'][0];check('upstream HTTPS media',urllib.parse.urlsplit(media).scheme=='https')
proxy=lambda u:'/api/proxy?'+urllib.parse.urlencode({'url':u})
r=request(proxy(media));body=r.read().decode();check('HLS manifest stream read',r.status==200 and '#EXTM3U' in body,bytes=len(body));r.close()
for _ in range(4):
 line=next(x.strip() for x in body.splitlines() if x.strip() and not x.startswith('#'));path=urllib.parse.urlsplit(urllib.parse.urljoin(base,line)).path;query=urllib.parse.urlsplit(urllib.parse.urljoin(base,line)).query;path+=('?'+query) if query else ''
 r=request(path,headers={'Range':'bytes=0-1023'});b=r.read(1024);ctype=r.headers.get('Content-Type','')
 if 'mpegurl' in ctype or b.startswith(b'#EXTM3U'):
  body=b.decode()+r.read().decode();r.close();continue
 check('HLS segment Range',r.status==206 and len(b)==1024,status=r.status,content_range=r.headers.get('Content-Range'),bytes=len(b));r.close();break
else:raise AssertionError('no media segment')
r=request(path);chunk=r.read(8192);r.close();check('normal media stream cancellation',len(chunk)>0,bytes_read=len(chunk),operation='close response before EOF')
r=request(path,headers={'Range':'bytes=0-1023'});check('Range remains usable after cancel',r.status==206 and len(r.read(1024))==1024);r.close()
pathlib.Path('A/revision/playback.json').write_text(json.dumps({'source':source,'id':'6573','segment_path':path},ensure_ascii=False))
pathlib.Path('A/revision/media-results.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
