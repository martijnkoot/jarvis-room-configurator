// No dependencies; run with CHROME_BIN pointing to Chromium/Chrome.
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'jrc-browser-'));
const chrome=spawn(process.env.CHROME_BIN||'google-chrome',['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--allow-file-access-from-files','about:blank'],{stdio:['ignore','ignore','pipe']});
const root=path.resolve(__dirname,'..');
const server=require('node:http').createServer((req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end('Not found');}}).listen(0,'127.0.0.1');
let socket,startError='',diagnostics='';
chrome.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-4000);});
const deadline=setTimeout(()=>{console.error('Browser validation timed out');socket?.close();chrome.kill();process.exitCode=1;},60000);
const pause=()=>new Promise(r=>setTimeout(r,100));
(async()=>{try{
 chrome.on('error',e=>{startError=e.message;});
 let port;for(let i=0;i<300;i++){if(startError||chrome.exitCode!==null)break;try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{await pause();}}
 if(!port)throw Error(`Chrome did not start within 30s (exit=${chrome.exitCode}). ${startError} ${diagnostics}`);
 const tabs=await(await fetch(`http://localhost:${port}/json`)).json();
 socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
 let id=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)(m);pending.delete(m.id);}};
 const send=(method,params={})=>new Promise(r=>{pending.set(++id,r);socket.send(JSON.stringify({id,method,params}));});
 for(const fixture of ['browser.html','floorplan-browser.html'])for(const width of [390,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:width<600?844:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/tests/${fixture}`});
  let output='';for(let i=0;i<80;i++){
   const r=await send('Runtime.evaluate',{expression:`location.pathname.endsWith('/${fixture}') ? document.querySelector('#results')?.textContent : ''`,returnByValue:true});output=r.result?.result?.value||'';
   if(output.includes('FAIL')||output.includes('PASS Finished'))break;await pause();
  }
  if(output.includes('FAIL')||!output.includes('PASS Finished'))throw Error(output||'Fixture did not complete');
  if(fixture==='floorplan-browser.html'){
   const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
   const drag=async rotate=>{
    const start=await evaluate(`(()=>{const e=window.floorTest.editor;e._preview.scrollIntoView({block:'center'});const svg=e._preview.shadowRoot.querySelector('svg'),s=e._config.placements[0],center=floorToMap([s.x,s.y]),local=${rotate}?[center[0],center[1]-.5]:[center[0]+.35,center[1]-.2],circle=e._preview.shadowRoot.querySelector(${rotate}? '[data-rotate=kantoor]':'[data-sensor=kantoor] circle'),m=svg.getScreenCTM(),a=new DOMPoint(+circle.getAttribute('cx'),+circle.getAttribute('cy')).matrixTransform(m),b=new DOMPoint(...local).matrixTransform(m);return {x:a.x,y:a.y,u:b.x,v:b.y,before:{...s}}})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x,y:start.y});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:start.x,y:start.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.u,y:start.v,button:'left',buttons:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.u,y:start.v,button:'left',clickCount:1});
    const after=await evaluate('window.floorTest.getSaved().placements[0]');
    if(rotate?Math.abs(after.yaw)>1e-4:Math.hypot(after.x-start.before.x-.2,after.y-start.before.y+.35)>1e-5)throw Error('Real pointer '+(rotate?'rotation':'translation')+' failed: '+JSON.stringify({start,after}));
    if(after.calibrated)throw Error('Pointer editing must invalidate calibration');
   };
   await drag(false);await drag(true);
   const panStart=await evaluate(`(()=>{const p=window.floorTest.editor._preview,svg=p.shadowRoot.querySelector('svg');p.shadowRoot.querySelector('[data-view=pan]').click();const r=svg.getBoundingClientRect();return {x:r.x+20,y:r.y+20,view:svg.getAttribute('viewBox')}})()`);
   await send('Input.dispatchMouseEvent',{type:'mousePressed',x:panStart.x,y:panStart.y,button:'left',clickCount:1});
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:panStart.x+30,y:panStart.y+20,button:'left',buttons:1});
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:panStart.x+30,y:panStart.y+20,button:'left',clickCount:1});
   if(await evaluate('window.floorTest.editor._preview.shadowRoot.querySelector("svg").getAttribute("viewBox")')===panStart.view)throw Error('Real pointer pan failed');
   await evaluate(`window.floorTest.editor._preview.shadowRoot.querySelector('[data-view=pan]').click();window.floorTest.editor._preview.shadowRoot.querySelector('[data-view=fit]').click()`);


   // Exercise the normal live card with actual screen pointer events, no Lovelace editing attribute.
   await evaluate(`document.body.replaceChildren(window.liveTest.card);window.liveTest.card.style.display='block';window.liveTest.card.style.maxWidth='1200px';window.liveTest.press('Inrichten');window.liveTest.press('Sensor plaatsen');window.confirm=()=>true`);
   const liveDrag=async selector=>{
    const a=await evaluate(`(()=>{const card=window.liveTest.card;const svg=card.shadowRoot.querySelector('svg');svg.scrollIntoView({block:'center'});const n=svg.querySelector('${selector}'),m=svg.getScreenCTM(),p=new DOMPoint(+n.getAttribute('cx'),+n.getAttribute('cy')).matrixTransform(m);return {x:p.x,y:p.y}})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:a.x,y:a.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+25,y:a.y+15,button:'left',buttons:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:a.x+25,y:a.y+15,button:'left',clickCount:1});
   };
   const liveBefore=await evaluate('JSON.stringify(window.liveTest.card._config.placements[0])');
   await liveDrag('[data-sensor=kantoor] circle:not(.selection)');
   if(await evaluate('window.liveTest.card._config.placements[0].x')===JSON.parse(liveBefore).x)throw Error('Live sensor drag failed');
   const yaw=await evaluate('window.liveTest.card._config.placements[0].yaw');
   await liveDrag('[data-live-rotate]');
   if(await evaluate('window.liveTest.card._config.placements[0].yaw')===yaw)throw Error('Live rotation failed');
   await evaluate(`window.liveTest.card._zoneInteraction=true;window.liveTest.card._zoneDraft=[[0,1],[.5,1],[.5,2]];window.liveTest.card._render()`);
   const zoneBefore=await evaluate('JSON.stringify(window.liveTest.card._zoneDraft)');
   await liveDrag('[data-zone-vertex="0"]');
   if(await evaluate('JSON.stringify(window.liveTest.card._zoneDraft)')===zoneBefore)throw Error('Live vertex drag failed');
   if(width===390){
    await send('Emulation.setTouchEmulationEnabled',{enabled:true});
    const t=await evaluate(`(()=>{const c=window.liveTest.card,s=c.shadowRoot.querySelector('svg');s.scrollIntoView({block:'center'});const n=s.querySelector('[data-zone-vertex="1"]'),p=new DOMPoint(+n.getAttribute('cx'),+n.getAttribute('cy')).matrixTransform(s.getScreenCTM());return {x:p.x,y:p.y,before:JSON.stringify(c._zoneDraft)}})()`);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:t.x,y:t.y,id:1}]});
    await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:t.x+12,y:t.y+10,id:1}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    if(await evaluate('JSON.stringify(window.liveTest.card._zoneDraft)')===t.before)throw Error('Touch vertex drag failed');
    await send('Emulation.setTouchEmulationEnabled',{enabled:false});
   }
   if(await evaluate('window.liveTest.calls.length')!==1)throw Error('Dragging wrote hardware');
   await evaluate(`window.liveTest.press('Annuleren')`);
   if(await evaluate('JSON.stringify(window.liveTest.card._config.placements[0])')!==liveBefore)throw Error('Cancel did not restore placement');
   await evaluate(`window.liveTest.press('Inrichten');window.liveTest.card._zoneInteraction=true;window.liveTest.card._zoneDraft=[[0,1],[.5,1],[.5,2]];window.liveTest.card._render();scrollTo(0,0)`);
   console.log(`${fixture} ${width}px: live pointer move, rotate, vertex drag and cancel passed`);
   if(process.env.SCREENSHOT_DIR){
    await evaluate("document.querySelector('#results')?.remove();scrollTo(0,0)");
    const shot=await send('Page.captureScreenshot',{format:'png'});
    fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR,`floorplan-${width}.png`),Buffer.from(shot.result.data,'base64'));
    await evaluate(`document.documentElement.style.cssText='--card-background-color:#1c232c;--secondary-background-color:#141a22;--primary-text-color:#e8edf2;--secondary-text-color:#aab8c8;--divider-color:#354352;--primary-color:#4ba9d5;--text-primary-color:#101923';document.body.style.background='#10151b'`);
    const dark=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR,`floorplan-dark-${width}.png`),Buffer.from(dark.result.data,'base64'));
    await evaluate(`document.documentElement.style.cssText='';document.body.style.background=''`);

   }
   console.log(`${fixture} ${width}px: real pointer translation and rotation passed`);
  }
  console.log(`${fixture} ${width}px: ${output.split('\n').length} browser checks passed`);
 }
 }finally{clearTimeout(deadline);socket?.close();chrome.kill();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
