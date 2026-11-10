import json,pathlib,subprocess,hashlib,time,os
root=pathlib.Path('/opt/libretv-security-20261110-r2')
prod=json.loads(subprocess.check_output(['docker','inspect','libretv-trial-web-1']))[0]
image=json.loads(subprocess.check_output(['docker','image','inspect','libretv-security:2210-review2']))[0]
assert image['Id']!=prod['Image']
env=dict(s.split('=',1) for s in prod['Config']['Env'])
values={k:env[k] for k in ['DEFAULT_SOURCES','DEFAULT_RECOMMEND_SOURCE','LIVE_ALLOW_PRIVATE'] if k in env}
values.update(PASSWORD='candidate-review-fixture-only',COOKIE_SECURE='true',NEXT_TELEMETRY_DISABLED='1',NODE_ENV='production')
(root/'candidate.env').write_text(''.join(k+'='+v+'\n' for k,v in values.items()));os.chmod(root/'candidate.env',0o600)
cmd=['docker','run','-d','--name','libretv-security-review2','--restart','no','--memory','768m','--cpus','1','--security-opt','no-new-privileges:true','-p','127.0.0.1:18081:8080','--env-file',str(root/'candidate.env'),image['Id']]
cid=subprocess.check_output(cmd,text=True).strip()
subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',str(root/'candidate.key'),'-out',str(root/'candidate.crt')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
os.chmod(root/'candidate.key',0o600)
proxy=r'''
import http.server,http.client,ssl
class Proxy(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):self.proxy()
 def do_POST(self):self.proxy()
 def do_DELETE(self):self.proxy()
 def proxy(self):
  conn=http.client.HTTPConnection('127.0.0.1',18081,timeout=60)
  try:
   headers={k:v for k,v in self.headers.items() if k.lower() not in ['connection','host']};headers['Host']='localhost';headers['X-Forwarded-Proto']='https'
   length=int(self.headers.get('Content-Length','0'));body=self.rfile.read(length) if length else None
   conn.request(self.command,self.path,body,headers);r=conn.getresponse();self.send_response(r.status)
   for k,v in r.getheaders():
    if k.lower() not in ['transfer-encoding','connection']:self.send_header(k,v)
   self.end_headers()
   while True:
    b=r.read(16384)
    if not b:break
    self.wfile.write(b);self.wfile.flush()
  except (BrokenPipeError,ConnectionResetError):pass
  finally:conn.close()
server=http.server.ThreadingHTTPServer(('127.0.0.1',18443),Proxy)
ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain('/opt/libretv-security-20261110-r2/candidate.crt','/opt/libretv-security-20261110-r2/candidate.key');server.socket=ctx.wrap_socket(server.socket,server_side=True);server.serve_forever()
'''
(root/'tls-proxy.py').write_text(proxy)
p=subprocess.Popen(['python3',str(root/'tls-proxy.py')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True);(root/'tls-proxy.pid').write_text(str(p.pid))
result={'production_container_id':prod['Id'],'production_image_id':prod['Image'],'production_started_at':prod['State']['StartedAt'],'candidate_container_id':cid,'candidate_image_id':image['Id'],'candidate_repo_digests':image.get('RepoDigests',[]),'candidate_image_architecture':image['Architecture'],'candidate_image_created':image['Created'],'candidate_port':'127.0.0.1:18081','candidate_tls':'127.0.0.1:18443','candidate_mounts':[],'candidate_env_keys':list(values),'live_allow_private':values.get('LIVE_ALLOW_PRIVATE','unset'),'password':'separate fixture; production password unchanged','cert_sha256':hashlib.sha256((root/'candidate.crt').read_bytes()).hexdigest(),'tls_proxy_pid':p.pid}
(root/'candidate-record.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
