// No dependencies; run with CHROME_BIN pointing to Chromium/Chrome.
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'jrc-browser-'));
const chrome=spawn(process.env.CHROME_BIN||'google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--allow-file-access-from-files','about:blank'],{stdio:'ignore'});
let socket;
const deadline=setTimeout(()=>{console.error('Browser validation timed out');socket?.close();chrome.kill();process.exitCode=1;},20000);
const pause=()=>new Promise(r=>setTimeout(r,100));
(async()=>{try{
 chrome.on('error',e=>{console.error(e.message);process.exitCode=1;});
 let port;for(let i=0;i<80;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{await pause();}}
 if(!port)throw Error('Chrome did not start. Set CHROME_BIN.');
 const tabs=await(await fetch(`http://localhost:${port}/json`)).json();
 socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
 let id=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)(m);pending.delete(m.id);}};
 const send=(method,params={})=>new Promise(r=>{pending.set(++id,r);socket.send(JSON.stringify({id,method,params}));});
 for(const width of [390,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1400,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:require('node:url').pathToFileURL(path.join(__dirname,'browser.html')).href});
  let output='';for(let i=0;i<80;i++){
   const r=await send('Runtime.evaluate',{expression:"document.querySelector('#results')?.textContent",returnByValue:true});output=r.result?.result?.value||'';
   if(output.includes('FAIL')||output.includes('PASS Apply'))break;await pause();
  }
  if(output.includes('FAIL')||!output.includes('PASS Apply'))throw Error(output||'Fixture did not complete');
  console.log(`${width}px: ${output.split('\n').length} browser checks passed`);
 }
 }finally{clearTimeout(deadline);socket?.close();chrome.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
