"""Actual assistant page/UI and player-bridge wiring in Chromium, mocked HTTP.
No Android server, native action execution, or real movie is exercised.
"""
from pathlib import Path
import json, time
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]/'app/src/main/assets'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
 page=browser.new_page()
 page.add_init_script("sessionStorage.setItem('lhtoken','browser-fixture-token')")
 mutations=[];errors=[];state={'startedAt':100000,'prove':False,'holdListing':False,'held':None,'failSystemOnce':False}
 page.on('pageerror',lambda error:errors.append(error.stack))
 def route(r):
  path=r.request.url.split('localhub.test',1)[-1].split('?')[0]
  if path=='/api/fs/list' and state['holdListing']:
   state['held']=r;return
  if path=='/api/system' and state['failSystemOnce']:
   state['failSystemOnce']=False;return r.fulfill(status=500,content_type='application/json',body='{}')
  if path.startswith('/api'):
   if path in ['/api/server/restart','/api/server/stop']:
    mutations.append(path)
    if state['prove'] and path=='/api/server/restart':state['startedAt']+=100000
   data={'ok':True}
   if path=='/api/auth/session':data={'authenticated':True,'role':'admin'}
   elif path=='/api/status':data={'running':True,'port':8080,'startedAt':state['startedAt'],'uptimeMs':5000}
   elif path=='/api/integration':data={'schemaVersion':1,'sampledAt':int(time.time()*1000),'source':'android-host-read-only','server':{'running':True,'port':8080,'protocol':'http','startedAt':state['startedAt']},'access':{'role':'admin'},'features':[{'id':id,'name':id,'enabled':True} for id in ['dashboard','files','ai','core.media','core.mirror','core.device','core.shares','core.monitor','core.tts','core.os','core.server','core.security']],'permissions':{'storage':'GRANTED','notifications':'GRANTED'},'lifecycle':{'assistant':'browser page'},'chatRecoveryPolicy':{'mode':'bounded-read-recovery'}}
   elif path=='/api/mirror/status':data={'ok':True,'running':False}
   elif path=='/api/tts/status':data={'ok':True,'available':True}
   elif path=='/api/system':data={'timestamp':int(time.time()*1000),'cpu':{'available':False,'usagePercent':0,'cores':4},'memory':{'totalBytes':1000,'usedBytes':100},'storage':{'totalBytes':10*1024**3,'usedBytes':200,'availableBytes':5*1024**3},'battery':{'level':80},'network':{'type':'WIFI','ipAddress':'192.168.1.2'},'device':{}}
   elif path=='/api/modules':data=[]
   elif path=='/api/clients':data={'clients':[]}
   elif path=='/api/logs':data={'logs':[]}
   elif path in ['/api/fs/list','/api/files']:data={'path':'/storage/emulated/0/Download','folders':[],'files':[{'name':'old.mp4','path':'/storage/emulated/0/Download/old.mp4','modified':100,'size':20,'isDir':False},{'name':'new.mkv','path':'/storage/emulated/0/Download/new.mkv','modified':200,'size':30,'isDir':False}]}
   elif path=='/api/fs/info':data={'ok':True,'name':'new.mkv','path':'/storage/emulated/0/Download/new.mkv','modified':200,'size':30,'isDir':False}
   return r.fulfill(status=200,content_type='application/json',body=json.dumps(data))
  aliases={'/ai':'ai/index.html','/player':'dashboard/player.html','/style.css':'dashboard/style.css','/brain':'dashboard/brain.html','/brain.js':'dashboard/brain.js','/selfheal':'dashboard/selfheal.html','/selfheal.js':'dashboard/selfheal.js'}
  asset=root/aliases.get(path,path.lstrip('/'))
  return r.fulfill(path=str(asset)) if asset.is_file() else r.fulfill(status=404,body='Missing fixture asset')
 page.route('http://localhub.test/**',route)
 page.goto('http://localhub.test/ai')
 page.wait_for_function('window.LH_AI && LH_AI.Brain && LH_AI.Brain.ready === true')
 def submit(text,expected):
  page.locator('#chat-input').fill(text);page.locator('#chat-send').click()
  page.wait_for_function('(s)=>document.getElementById("chat-log").textContent.includes(s)',arg=expected)
 submit('How do I restart server?','no restart was performed')
 assert mutations==[],mutations
 submit('stop it','I will not guess')
 assert mutations==[],mutations
 submit('restart server','Reply “confirm”')
 assert mutations==[],mutations
 submit('confirm','Completion is not yet verified')
 assert mutations==['/api/server/restart'],mutations
 submit('confirm','There is no current action to confirm')
 assert mutations==['/api/server/restart'],mutations
 state['prove']=True
 submit('restart server','Reply “confirm”')
 submit('confirm','Observed a new server listener start')
 assert mutations==['/api/server/restart','/api/server/restart'],mutations
 assert not errors,errors
 before=page.evaluate("async()=> (await LH_AI.Memory.getAll('chats')).filter(x=>x.role==='assistant').length")
 page.evaluate("LH_AI.Brain.handleUserMessage('hello')")
 page.wait_for_function("async(n)=> (await LH_AI.Memory.getAll('chats')).filter(x=>x.role==='assistant').length > n",arg=before)
 page.wait_for_timeout(250)
 assert page.evaluate("async()=> (await LH_AI.Memory.getAll('chats')).filter(x=>x.role==='assistant').length")==before+1
 assert page.evaluate('typeof LH_AI.SelfHeal.FileEngine.applyFilePatch') == 'function'
 print('PASS actual assistant UI: information/clarification/confirmation/one-shot request with mocked backend')
 submit('explain system integration','not a native background repair daemon')
 submit('check localhub health','CPU load is unavailable')
 state['failSystemOnce']=True
 submit('repair localhub','1 transient read(s) recovered')
 assert len(mutations)==2
 assert page.evaluate('LH_AI.SystemIntegration.version')==1
 submit('approve fix','No repair action was run')
 assert len(mutations)==2
 print('PASS actual health/integration UI explains limits, reports unknown CPU and bounded read recovery without extra server mutations (mocked host)')
 page.locator('#chat-input').fill('play newest modified video in downloads');page.locator('#chat-send').click()
 page.wait_for_url('**/player?file=%2Fstorage%2Femulated%2F0%2FDownload%2Fnew.mkv')
 assert len(mutations)==2
 print('PASS actual chat reviewed workflow selects newest modified file and requests correct player URL (mocked metadata)')
 page.goto('http://localhub.test/ai');page.wait_for_function('LH_AI.Brain.ready === true')
 state['holdListing']=True
 page.locator('#chat-input').fill('play newest modified video in downloads');page.locator('#chat-send').click()
 for _ in range(60):
  if state['held'] is not None:break
  page.wait_for_timeout(50)
 assert state['held'] is not None,'Listing request did not start'
 submit('cancel','Cancellation requested')
 page.wait_for_timeout(300)
 assert '/ai' in page.url
 state['holdListing']=False
 try:state['held'].abort()
 except Exception:pass  # fetch abort may already have closed this fixture route
 assert len(mutations)==2
 print('PASS actual chat cancels held listing read without navigating or sending mutation')
 # Exercise the actual player storage listener, not a replacement handler.
 page.goto('http://localhub.test/player?file=/storage/layout.mp4&token=fixture-secret')
 page.wait_for_timeout(700)
 def control(target,level,age=0):
  page.evaluate('''([target,level,age])=>window.dispatchEvent(new StorageEvent('storage',{
   key:'lhmc',newValue:JSON.stringify({cmd:'volume',ts:Date.now()-age,params:{targetFile:target,level:level}})
  }))''',[target,level,age])
 assert 'fixture-secret' not in page.evaluate("JSON.parse(localStorage.getItem('lhmedia_status')).src")
 initial=page.locator('#media').evaluate('(m)=>m.volume')
 control('/storage/other.mp4',.2)
 assert page.locator('#media').evaluate('(m)=>m.volume')==initial
 control('/storage/layout.mp4',.3)
 assert abs(page.locator('#media').evaluate('(m)=>m.volume')-.3)<.001
 control('/storage/layout.mp4',.8,16000)
 assert abs(page.locator('#media').evaluate('(m)=>m.volume')-.3)<.001
 assert not errors,errors
 print('PASS actual player listener: target-file routing and stale-command rejection')
 for url in ['/brain','/selfheal']:
  page.goto('http://localhub.test'+url);page.wait_for_timeout(400)
  assert page.evaluate('window.global === window')
  assert not errors,errors
 print('PASS brain/self-heal pages bootstrap without missing-global errors (mocked APIs)')
 # A real v1 connection must not silently strand the app in half-initialized state.
 isolated=browser.new_context();isolated.route('http://localhub.test/**',route)
 holder=isolated.new_page();holder.goto('http://localhub.test/blank')
 holder.evaluate('''()=>new Promise(resolve=>{const r=indexedDB.open('localhub_ai',1);r.onupgradeneeded=()=>['memories','knowledge','tasks','automations','plugins','settings','chats'].forEach(n=>r.result.createObjectStore(n,{keyPath:'id'}));r.onsuccess=()=>{window.oldDB=r.result;resolve()}})''')
 blocked=isolated.new_page();blocked_errors=[];blocked.on('pageerror',lambda e:blocked_errors.append(e.stack));blocked.goto('http://localhub.test/ai')
 blocked.wait_for_function("document.getElementById('chat-log').textContent.includes('Close older LocalHub tabs')")
 assert blocked.locator('#chat-input').is_disabled()
 assert blocked.locator('#chat-send').is_disabled()
 blocked.wait_for_timeout(200)
 assert not blocked_errors,blocked_errors
 holder.evaluate('oldDB.close()');blocked.reload()
 blocked.wait_for_function('LH_AI.Brain.ready === true')
 assert not blocked.locator('#chat-input').is_disabled()
 assert not blocked_errors,blocked_errors
 print('PASS blocked history upgrade gives user feedback; closing old tab + reload restores assistant')
 browser.close()
