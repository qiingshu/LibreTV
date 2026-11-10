import subprocess,json,pathlib,urllib.request,ssl,time
root=pathlib.Path('/opt/libretv-security-20261110-r2');record=json.loads((root/'candidate-record.json').read_text());name='libretv-security-review2';out=[]
ctx=ssl.create_default_context(cafile=str(root/'candidate.crt'))
def run(image):
 subprocess.run(['docker','stop','--time','10',name],check=True,stdout=subprocess.DEVNULL)
 subprocess.run(['docker','rm',name],check=True,stdout=subprocess.DEVNULL)
 cid=subprocess.check_output(['docker','run','-d','--name',name,'--restart','no','--memory','768m','--cpus','1','--security-opt','no-new-privileges:true','-p','127.0.0.1:18081:8080','--env-file',str(root/'candidate.env'),image],text=True).strip()
 for i in range(30):
  try:
   req=urllib.request.Request('https://127.0.0.1:18443/api/auth',data=json.dumps({'password':'candidate-review-fixture-only'}).encode(),headers={'Content-Type':'application/json'})
   with urllib.request.urlopen(req,context=ctx,timeout=3) as r:assert r.status==200
   c=json.loads(subprocess.check_output(['docker','inspect',name]))[0];assert c['Image']==image and c['Mounts']==[]
   return cid
  except Exception:
   if i==29:raise
   time.sleep(.4)
try:
 cid=run(record['production_image_id']);out.append({'step':'rollback original image on candidate port only','image_id':record['production_image_id'],'container_id':cid,'https_fixture_login':True})
finally:
 cid=run(record['candidate_image_id']);out.append({'step':'restore revised candidate image on candidate port only','image_id':record['candidate_image_id'],'container_id':cid,'https_fixture_login':True})
p=json.loads(subprocess.check_output(['docker','inspect','libretv-trial-web-1']))[0]
assert p['Id']==record['production_container_id'] and p['Image']==record['production_image_id'] and p['State']['StartedAt']==record['production_started_at']
assert p['HostConfig']['PortBindings']=={'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'18080'}]}
out.append({'step':'production guard','container_id':p['Id'],'image_id':p['Image'],'started_at':p['State']['StartedAt'],'unchanged':True})
(root/'rollback-rehearsal.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
