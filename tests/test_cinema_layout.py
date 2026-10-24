"""Real headless Chromium layout checks with mocked HTTP/media metadata.
Not a device, film playback or audio decoding test. Requires playwright Chromium.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]/'app/src/main/assets'
shots=Path(__file__).resolve().parents[1]/'.cache/layout'
shots.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
 page=browser.new_page()
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 def route(r):
  path=r.request.url.split('localhub.test',1)[-1].split('?')[0]
  if path.startswith('/api/'):
   if path=='/api/fs/audio-tracks':data={'tracks':[{'track':0,'language':'eng','codec':'aac','channels':2,'isDefault':True}]}
   elif path=='/api/fs/list':data={'files':[]}
   elif path=='/api/fs/content':return r.fulfill(status=404,body='Fixture: no real movie')
   else:data={'ok':True,'size':1024,'authenticated':True,'role':'user'}
   return r.fulfill(status=200,content_type='application/json',body=json.dumps(data))
  aliases={'/player':'dashboard/player.html','/style.css':'dashboard/style.css'}
  asset=root/aliases.get(path,path.lstrip('/'))
  if asset.is_file():return r.fulfill(path=str(asset))
  r.fulfill(status=404,body='Not found')
 page.route('http://localhub.test/**',route)
 for width,height in [(1600,900),(390,844),(320,640),(844,390)]:
  page.set_viewport_size({'width':width,'height':height})
  page.goto('http://localhub.test/player?file=/storage/emulated/0/Download/Layout-Test.mp4')
  page.wait_for_timeout(300)
  page.evaluate('''() => { const m=document.getElementById('media'); m.removeAttribute('src');
   Object.defineProperty(m,'duration',{configurable:true,get:()=>8700});
   Object.defineProperty(m,'currentTime',{configurable:true,get:()=>90});
   m.dispatchEvent(new Event('timeupdate'));
   document.getElementById('toast').style.display='none';
  }''')
  media=page.locator('#media').bounding_box()
  wrap=page.locator('#video-wrap').bounding_box()
  assert wrap['width']>width*.90,(width,wrap)
  assert wrap['height']>height*.75,(height,wrap)
  assert abs(media['width']-wrap['width'])<3,(media,wrap)
  buttons=['btn-quick-back','btn-play','btn-quick-forward','btn-mute','btn-audio','btn-subtitle','btn-more','btn-fs']
  boxes=[page.locator('#'+id).bounding_box() for id in buttons]
  for id,b in zip(buttons,boxes):
   assert b and b['x']>=0 and b['x']+b['width']<=width+1,(width,id,b)
   assert b['height']>=34,(id,b)
  for a,b in zip(boxes,boxes[1:]):assert a['x']+a['width']<=b['x']+1,(width,a,b)
  page.screenshot(path=str(shots/f'cinema-{width}x{height}.png'))
  page.locator('#btn-more').click()
  assert page.locator('#settings-pop').is_visible()
  assert page.locator('#btn-repeat').is_visible()
  # Native fullscreen is also exercised in Chromium (not an Android fullscreen test).
  page.evaluate("document.getElementById('video-wrap').requestFullscreen()")
  page.wait_for_timeout(100)
  fs=page.locator('#video-wrap').bounding_box()
  assert abs(fs['width']-width)<2 and abs(fs['height']-height)<2,fs
  page.evaluate('document.exitFullscreen()')
  print('PASS cinema layout/control bounds/settings/fullscreen',width,height)
 assert not errors,errors
 browser.close()
 print('PASS no uncaught browser script exceptions in fixture')
