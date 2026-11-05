// No dependencies; run with CHROME_BIN pointing to Chromium/Chrome.
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'jrc-browser-'));
const chrome=spawn(process.env.CHROME_BIN||'google-chrome',['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--allow-file-access-from-files','about:blank'],{stdio:['ignore','ignore','pipe']});
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
  await send('Emulation.setDeviceMetricsOverride',{width,height:1400,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:require('node:url').pathToFileURL(path.join(__dirname,fixture)).href});
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
   if(process.env.SCREENSHOT_DIR){
    await evaluate('scrollTo(0,0)');
    const shot=await send('Page.captureScreenshot',{format:'png'});
    fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR,`floorplan-${width}.png`),Buffer.from(shot.result.data,'base64'));
   }
   console.log(`${fixture} ${width}px: real pointer translation and rotation passed`);
  }
  console.log(`${fixture} ${width}px: ${output.split('\n').length} browser checks passed`);
 }
 }finally{clearTimeout(deadline);socket?.close();chrome.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
