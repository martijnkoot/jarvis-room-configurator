const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('dist/jarvis-room-configurator.js','utf8');
function load(){
 const registry=new Map(),c=vm.createContext({HTMLElement:class{attachShadow(){this.shadowRoot={};}},customElements:{get:k=>registry.get(k),define:(k,v)=>registry.set(k,v)},window:{}});
 vm.runInContext(source,c);return {c,run:code=>vm.runInContext(code,c),registry};
}
test('annotation registration is an isometry and three outer landmarks agree within one pixel',()=>{
 const {run}=load();
 for(const [x,y,u,v]of [[8.444937706,11.150891304,85,88],[3.244936943,11.150891304,85,504],[3.244936943,-.522855341,1019,504]]){
  const p=run(`floorToMap([${x},${y}])`);assert.ok(Math.abs(85+80*p[0]-u)<1&&Math.abs(88+80*p[1]-v)<1);
  const back=run(`floorFromMap(floorToMap([${x},${y}]))`);assert.ok(Math.hypot(back[0]-x,back[1]-y)<1e-10);
 }
 assert.ok(Math.abs(run('Math.hypot(...floorToMap([7,10]).map((v,i)=>v-floorToMap([4,6])[i]))')-5)<1e-10);
 assert.ok(run('floorDefaults().placements.every(s=>!s.calibrated&&s.height===null)'));
 // Stated image directions: green down, blue left; no shared/global sensor heading.
 assert.ok(run('(()=>{const s=floorDefaults().placements[0],a=floorToMap([s.x,s.y]),b=floorToMap(floorProject(s,{},0,1));return Math.abs(a[0]-b[0])<1e-9&&b[1]>a[1]})()'));
 assert.ok(run('(()=>{const s=floorDefaults().placements[1],a=floorToMap([s.x,s.y]),b=floorToMap(floorProject(s,{},0,1));return b[0]<a[0]&&Math.abs(a[1]-b[1])<1e-9})()'));
});
test('geometry embedding exactly matches reviewed source with no placement/hardware coupling',()=>{
 const {run}=load(),geometry=JSON.parse(fs.readFileSync('geometry/begane-grond.json'));
 assert.deepEqual(JSON.parse(run('JSON.stringify(jarvisGroundFloor)')),geometry);assert.equal(geometry.sensors.length,0);
});
test('projection preserves distances for independent headings and flips',()=>{
 const {run}=load();for(const yaw of [-180,-45,0,90,135])for(const flip_x of [false,true])for(const flip_y of [false,true]){
 const [x,y]=run(`floorProject({x:2,y:3,yaw:${yaw}},{flip_x:${flip_x},flip_y:${flip_y}},3,4)`);
 assert.ok(Math.abs(Math.hypot(x-2,y-3)-5)<1e-10);
 }
});
test('invalid poses/mappings are rejected and unknown Lovelace options survive',()=>{
 const {run}=load();
 for(const patch of ['x:NaN','yaw:Infinity','mounting:"roof"','fov_start:60','height:-1'])assert.throws(()=>run(`floorValidate({...floorDefaults(),placements:[{...floorDefaults().placements[0],${patch}}]})`));
 assert.throws(()=>run('floorValidate({...floorDefaults(),placements:[floorDefaults().placements[0],floorDefaults().placements[0]]})'));
 for(const h of ['{targets:[{x_entity:"sensor.a",y_entity:"sensor.a"}]}','{targets:[],axes_confirmed:"yes"}','{targets:[],mode_entity:"sensor.mode"}'])assert.throws(()=>run(`floorValidate({...floorDefaults(),hardware:{kantoor:${h}}})`));
 assert.equal(run('floorValidate({...floorDefaults(),grid_options:{columns:"full"},future:{key:42}}).future.key'),42);
});
test('target units fail closed; zero and six metre limits are enforced in the rendering path',()=>{
 const {run}=load();for(const [unit,value,expected]of [['m','1.5',1.5],['cm','150',1.5],['mm','1500',1.5],['ft','2',null],['m','unavailable',null],['m','',null]])assert.equal(run(`floorMetres({state:${JSON.stringify(value)},attributes:{unit_of_measurement:${JSON.stringify(unit)}}})`),expected);
});
test('live targets ignore legacy calibration gates but unsupported projection is explicit',()=>{
 const {run}=load();run('var card=new JarvisFloorplanCard();card._render=()=>{};card.setConfig(floorDefaults());var s=card._config.placements[0]');
 assert.match(run('card._reason(s)'),/Choose a roomnode/);
 run('card._config.hardware.kantoor={targets:[{x_entity:"sensor.x",y_entity:"sensor.y"}],axes_confirmed:false}');
 assert.equal(run('card._reason(s)'),null);
 assert.match(run('s.mounting="ceiling";card._reason(s)'),/not yet supported/);
 assert.match(run('s.mounting="wall";s.tilt=5;card._reason(s)'),/not yet supported/);
 assert.match(run('s.tilt=0;card._config.hardware.kantoor.mode_entity="select.mode";card._hass={states:{"select.mode":{state:"top"}}};card._reason(s)'),/not Side/);
 assert.equal(run('card._hass.states["select.mode"].state="side";card._reason(s)'),null);
});
test('image replacement preserves poses, hardware and unknown options while invalidating scale check',()=>{
 const {c,run}=load();c.URL=URL;
 const before=run('JSON.stringify({...floorDefaults(),calibration:{dimensions_confirmed:true,custom:7},unknown:42})');
 c.before=JSON.parse(before);
 const after=JSON.parse(run(`JSON.stringify(floorReplaceImage(before,{url:'/local/house.svg',width:10,height:5,x:-2,y:3,rotation:90}))`));
 assert.deepEqual(after.placements,c.before.placements);assert.deepEqual(after.hardware,c.before.hardware);
 assert.equal(after.unknown,42);assert.equal(after.calibration.custom,7);assert.equal(after.calibration.dimensions_confirmed,false);
 c.next=after;assert.equal(run('floorReplaceImage(next,null).floorplan_image'),null);
});
test('rejects transient, executable, credential and invalid image configuration',()=>{
 const {c,run}=load();c.URL=URL;
 for(const url of ['blob:123','data:image/svg+xml,a','javascript:alert(1)','http://example.com/a.png','//example.com/a.png','https://u:p@example.com/a.jpg','/local/a.html','/local/a.png" onload="x','/local/../a.svg\\x']){
  c.url=url;assert.throws(()=>run(`floorImageValidate({url,width:10,height:5,x:0,y:0,rotation:0})`),url);
 }
 for(const patch of [{width:0},{height:Infinity},{rotation:361},{x:null}]){c.patch=patch;assert.throws(()=>run(`floorImageValidate({url:'/local/a.png',width:10,height:5,x:0,y:0,rotation:0,...patch})`));}
 for(const url of ['/local/a.svg','/local/a.PNG?v=2','https://example.com/house.jpg']){c.url=url;run(`floorImageValidate({url,width:10,height:5,x:0,y:0,rotation:0})`);}
});
test('fit bounds include all four corners of rotated and translated images',()=>{
 const {run}=load();
 const bounds=run('floorImageBounds({width:10,height:5,x:2,y:3,rotation:90})');
 assert.ok(Math.abs(bounds[0]+3.8)<1e-9);assert.ok(Math.abs(bounds[1]-2.2)<1e-9);
 assert.ok(Math.abs(bounds[2]-6.6)<1e-9);assert.ok(Math.abs(bounds[3]-11.6)<1e-9);
});

test('global/local roundtrip includes scale, arbitrary headings, mirrors and map registration',()=>{
 const {run}=load();for(const yaw of [-360,-170,-45,0,37,90,180,360])for(const flip_x of [false,true])for(const flip_y of [false,true])for(const scale of [.1,1,3.5,10]){
 const p=run(`(()=>{const s={x:-12.3,y:45.6,yaw:${yaw},scale:${scale}},h={flip_x:${flip_x},flip_y:${flip_y}};return floorUnproject(s,h,...floorFromMap(floorToMap(floorProject(s,h,-.8,2.3))))})()`);
 assert.ok(Math.hypot(p[0]+.8,p[1]-2.3)<1e-10);
 }
});
test('zone serialization rejects invalid geometry and enforces physical FOV before write',()=>{
 const {run}=load();assert.equal(run('floorZoneValue([[0,1],[.5,1],[0,2]])'),'0:1000;500:1000;0:2000');assert.equal(run('floorZoneValue([])'),'');
 for(const points of ['[[0,1]]','[[0,-1],[1,1],[0,2]]','[[0,7],[1,1],[0,2]]','[[2,.1],[1,1],[0,2]]','[[NaN,1],[1,1],[0,2]]'])assert.throws(()=>run(`floorZoneValue(${points})`));
});
test('apply fails closed for no arrangement, changed entity, external changes, errors and unsupported mounting',async()=>{
 const {run,c}=load();c.window.confirm=()=>true;
 run(`var calls=[];var card=new JarvisFloorplanCard();card._render=()=>{};card._message=t=>{card.message=t};card._config=floorDefaults();card._selectedSensor='kantoor';card._zoneEntity='text.zone';card._zoneOriginal='';card._zoneDraft=[[0,1],[.5,1],[0,2]];card._source=()=>({polygons:{'zone:1':'text.zone'}});card._hass={states:{'text.zone':{state:'',attributes:{}}},callService:async(...args)=>calls.push(args)};`);
 await run('card._applyZone()');assert.equal(run('calls.length'),0);
 run('card._arranging=true;card._zoneEntity="text.other"');await run('card._applyZone()');assert.equal(run('calls.length'),0);
 run('card._zoneEntity="text.zone";card._hass.states["text.zone"].state="0:0"');await run('card._applyZone()');assert.match(run('card.message'),/intussen veranderd/);
 run('card._hass.states["text.zone"].state="";card._config.placements[0].mounting="ceiling"');await run('card._applyZone()');assert.equal(run('calls.length'),0);
 run('card._config.placements[0].mounting="wall"');c.window.confirm=()=>false;await run('card._applyZone()');assert.equal(run('calls.length'),0);
 c.window.confirm=()=>true;await run('card._applyZone()');assert.equal(run('calls.length'),1);assert.equal(run('card._rollback.value'),'');
 run('card._hass.callService=async()=>{throw Error("offline")}');await run('card._applyZone(true)');assert.equal(run('card._applying'),false);assert.match(run('card.message'),/offline/);assert.equal(run('card._zoneDraft.length'),3);
});
