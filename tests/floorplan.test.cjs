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
