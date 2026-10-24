"""Real Chromium IndexedDB migration/adapter tests, not a Personal Brain model test."""
from pathlib import Path
from playwright.sync_api import sync_playwright
source=(Path(__file__).resolve().parents[1]/'app/src/main/assets/ai/memory.js').read_text()
with sync_playwright() as p:
 browser=p.chromium.launch(args=['--no-sandbox'])
 context=browser.new_context();page=context.new_page()
 context.route('http://memory.test/**',lambda r:r.fulfill(content_type='text/html',body='<html><body>Storage fixture</body></html>'))
 page.goto('http://memory.test/')
 page.evaluate('''()=>new Promise((resolve,reject)=>{
  const req=indexedDB.open('localhub_ai',1);
  req.onupgradeneeded=()=>['memories','knowledge','tasks','automations','plugins','settings','chats'].forEach(n=>req.result.createObjectStore(n,{keyPath:'id'}));
  req.onsuccess=()=>{const db=req.result,tx=db.transaction('memories','readwrite');tx.objectStore('memories').put({id:'legacy',text:'keep this'});tx.oncomplete=()=>{db.close();resolve()};};req.onerror=()=>reject(req.error);
 })''')
 page.add_script_tag(content=source)
 result=page.evaluate('''async()=>{
  const m=LH_AI.Memory;
  if((await m.get('memories','legacy')).text!=='keep this')throw Error('Lost v1 record');
  for(const store of ['context','episodes','personal_profile','personal_state','journals','brain_timeline']) {
   await m.put(store,{id:'test',value:store});if((await m.get(store,'test')).value!==store)throw Error(store);
  }
  await Promise.all(Array.from({length:12},(_,i)=>m.put('facts',{id:'f'+i,value:i})));
  if((await m.getAll('facts')).length!==12)throw Error('Concurrent writes');
  await m.remove('facts','f0');if((await m.getAll('facts')).length!==11)throw Error('Remove');
  await m.clear('facts');if((await m.getAll('facts')).length)throw Error('Clear');
  let invalid=false;try{await m.get('typo_store','x')}catch(e){invalid=/Unknown local store/.test(e.message)}if(!invalid)throw Error('Unknown store accepted');
  let clone=false;try{await m.put('facts',{id:'bad',fn:()=>1})}catch(e){clone=true}if(!clone)throw Error('Clone failure hidden');
  await m.put('facts',{id:'good',value:1});
  const db=await m.open();const result={version:db.version,stores:db.objectStoreNames.length};db.close();return result;
 }''')
 assert result['version']==2
 print('PASS real IndexedDB v1→v2 upgrade retains data; new stores, concurrent CRUD, unknown-store and clone failures;',result)
 # Separate origin/context: keep a genuinely old connection open to test blocked upgrade.
 c=browser.new_context();c.route('http://memory.test/**',lambda r:r.fulfill(content_type='text/html',body='<html></html>'))
 holder=c.new_page();holder.goto('http://memory.test/')
 holder.evaluate('''()=>new Promise(resolve=>{const r=indexedDB.open('localhub_ai',1);r.onupgradeneeded=()=>r.result.createObjectStore('memories',{keyPath:'id'});r.onsuccess=()=>{window.held=r.result;resolve()}})''')
 upgrader=c.new_page();upgrader.goto('http://memory.test/');upgrader.add_script_tag(content=source)
 error=upgrader.evaluate('''()=>LH_AI.Memory.open().then(()=>'',e=>e.message)''')
 assert 'Close older LocalHub tabs' in error,error
 holder.evaluate('held.close()');upgrader.wait_for_timeout(150)
 assert upgrader.evaluate('''async()=>{const db=await LH_AI.Memory.open();const v=db.version;db.close();return v}''')==2
 print('PASS blocked upgrade reports actionable error; closing old tab allows upgrade without data reset')
 browser.close()
