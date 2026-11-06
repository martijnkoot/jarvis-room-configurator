const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('dist/jarvis-room-configurator.js','utf8');
function load(){
  const registry=new Map();
  const context=vm.createContext({HTMLElement:class {attachShadow(){this.shadowRoot={querySelector:()=>({disabled:false})};}},
    customElements:{get:k=>registry.get(k),define:(k,v)=>registry.set(k,v)},window:{}});
  vm.runInContext(`{${source}}`,context);
  const card=new (registry.get('jarvis-target-card'))();
  card._build=()=>{};card._render=()=>{};card._status=()=>{};
  card.setConfig({entity_prefix:'sensor.office_',range:5});
  return {card,context,registry};
}
const state=(value,unit)=>({state:String(value),attributes:{unit_of_measurement:unit}});
test('loads without backend, imports or network; registration is idempotent',()=>{
 const {context,registry}=load();vm.runInContext(`{${source}}`,context);
 assert.equal(registry.size,4);assert.equal(context.window.customCards.length,1);
});
test('reads targets in metres, centimetres and millimetres; rejects unavailable units',()=>{
 const {card}=load();card.hass={states:{
 'sensor.office_tracking_target_1_x':state(1000,'mm'),'sensor.office_tracking_target_1_y':state(200,'cm'),
 'sensor.office_tracking_target_2_x':state(1,'m'),'sensor.office_tracking_target_2_y':state(2,'m'),
 'sensor.office_tracking_target_3_x':state('unavailable','m'),'sensor.office_tracking_target_3_y':state(2,'m'),
 'sensor.other_target_1_x':state(3,'m')}};
 assert.equal(card._readTargets().coords.size,2);
 assert.deepEqual([...card._readTargets().coords.get('1')],[238,210]);
});
test('coordinate flips round trip and polygon format stays in firmware millimetres',()=>{
 const {card}=load();for(const flip_x of [false,true])for(const flip_y of [false,true]){
 card.setConfig({entity_prefix:'sensor.office_',flip_x,flip_y});
 const p=card._inverse(...card._transform(1,2));assert.ok(Math.abs(p[0]-1)<1e-9&&Math.abs(p[1]-2)<1e-9);
 }
 assert.equal(card._serialize(card._parse('1000:500;0:2000;-500:1000')),'1000:500;0:2000;-500:1000');
 assert.equal(card._parse('broken'),null);
});
test('HA updates do not write; explicit apply writes only the selected ESPHome entity',async()=>{
 const {card}=load();const calls=[];
 card.hass={states:{'text.office_polygon_zone_1':state('')},callService:async(...args)=>calls.push(args)};
 assert.equal(calls.length,0);card._draft=[[1,0],[0,2],[-1,0]];await card._apply();
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['text','set_value',{entity_id:'text.office_polygon_zone_1',value:'1000:0;0:2000;-1000:0'}]]);
 assert.equal(card._draft,null);
});
test('ambiguous entities, unfinished drawings and invalid polygons never write',async()=>{
 const {card}=load();const calls=[];card.hass={states:{'text.office_a_polygon_zone_1':state(''),'text.office_b_polygon_zone_1':state('')},callService:async(...a)=>calls.push(a)};
 card._draft=[[0,0],[1,1],[2,0]];await card._apply();
 delete card._hass.states['text.office_b_polygon_zone_1'];card._drawing=true;await card._apply();
 card._drawing=false;card._draft=[[0,0]];await card._apply();assert.equal(calls.length,0);
});
test('failed service keeps draft, and counts come from HA rather than displayed targets',async()=>{
 const {card}=load();card.hass={states:{'text.office_polygon_zone_1':state(''),'sensor.office_polygon_zone_1_target_count':state(2)},callService:async()=>{throw Error('offline');}};
 card._draft=[[0,0],[1,1],[2,0]];await card._apply();assert.equal(card._draft.length,3);assert.equal(card._zoneCount(1),2);
 card._hass.states['sensor.office_polygon_zone_1_target_count']=state('unavailable');assert.equal(card._zoneCount(1),null);
});
test('hardware geometry shares target coordinates under every flip',()=>{
 const {card}=load();for(const flip_x of [false,true])for(const flip_y of [false,true]){
 card.setConfig({entity_prefix:'sensor.office_',range:8,flip_x,flip_y});const points=card._sectorPoints(6,-60,60);
 for(const [i,x,y] of [[0,-3*Math.sqrt(3),3],[32,0,6],[64,3*Math.sqrt(3),3]]){
 const p=card._inverse(...points[i]);assert.ok(Math.abs(p[0]-x)<1e-9&&Math.abs(p[1]-y)<1e-9);}
 }});
test('device sector uses unique validated number entities, independent of hardware and polygons',()=>{
 const {card}=load();const states={
 'number.office_tracking_radar_detection_distance':state(250,'cm'),
 'number.office_tracking_radar_detection_start_angle':state(-20,'°'),
 'number.office_tracking_radar_detection_end_angle':state(40,'°'),
 'text.office_polygon_zone_1':state('0:0;1000:1000;0:2000')};card.hass={states};
 assert.deepEqual(JSON.parse(JSON.stringify(card._configuredSector())),{distance:2.5,start:-20,end:40});
 assert.equal(card._config.fov_range,6);assert.equal(card._config.fov_angle,120);
 for(const bad of [state('','m'),state('unavailable','m'),state(7,'m'),state(4)]){
 states['number.office_tracking_radar_detection_distance']=bad;assert.equal(card._configuredSector(),null);}
 states['number.office_tracking_radar_detection_distance']=state(4,'m');
 states['number.office_other_tracking_radar_detection_distance']=state(4,'m');assert.equal(card._configuredSector(),null);
 delete states['number.office_other_tracking_radar_detection_distance'];
 states['number.office_tracking_radar_detection_start_angle']=state(70,'°');assert.equal(card._configuredSector(),null);
});
test('FOV options and mounting mode fail safely',()=>{
 const {card}=load();for(const c of [{fov_range:0},{fov_range:7},{fov_angle:NaN},{fov_angle:121},{show_fov:'yes'}])assert.throws(()=>card.setConfig({entity_prefix:'sensor.office_',...c}));
 card.setConfig({entity_prefix:'sensor.office_'});card.hass={states:{}};assert.equal(card._sideMount(),true);
 const id='select.office_tracking_radar_installation_mode';for(const mode of ['top','unknown','unavailable']){card._hass.states[id]=state(mode);assert.equal(card._sideMount(),false);}
 card._hass.states[id]=state('side');assert.equal(card._sideMount(),true);
 card._hass.states['select.office_other_tracking_radar_installation_mode']=state('side');assert.equal(card._sideMount(),false);
});
test('rendering keeps passive FOV below zones and animated targets; supports hiding',()=>{
 const {card,context}=load();function element(tag){return {tag,attrs:{},children:[],style:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},append(...els){this.children.push(...els);},replaceChildren(){this.children=[];}};}
 context.document={createElementNS:(_,tag)=>element(tag),createElement:element};context.requestAnimationFrame=()=>1;
 const svg=element('svg'),nodes={'svg':svg,'#legend':element('div'),'#save':element('button'),'#draw':element('button'),'#status':element('div')};card.shadowRoot.querySelector=k=>nodes[k];delete card._render;
 card.hass={states:{'text.office_polygon_zone_1':state('0:0;1000:1000;0:2000'),'sensor.office_target_1_x':state(.5,'m'),'sensor.office_target_1_y':state(2,'m')}};
 const index=svg.children.findIndex(e=>e.attrs['data-layer']==='fov'),fov=svg.children[index];
 assert.equal(fov.attrs['pointer-events'],'none');assert.equal(fov.children.filter(e=>e.attrs.class==='fov-arc').length,6);
 assert.ok(index<svg.children.findIndex(e=>e.tag==='polygon'));assert.ok(index<svg.children.findIndex(e=>e.attrs['data-layer']==='targets'));
 card.isConnected=true;card._animate(100);assert.equal(svg.children[index],fov);assert.equal(card._targetLayer.children.length,2);
 card._config.show_fov=false;card._render();assert.equal(svg.children.some(e=>e.attrs['data-layer']==='fov'),false);
});
test('smoothing and fading trails continue with FOV enabled',()=>{
 const {card,context}=load();context.requestAnimationFrame=()=>1;card.isConnected=true;
 card._targetLayer={replaceChildren(){}};card._makeTarget=()=>{};const segments=[];card._el=(_,tag,attrs)=>segments.push(attrs);
 card._desiredTargets=new Map([['1',[100,100]]]);card._targetPos.set('1',[0,0]);card._lastFrame=100;
 card._animate(200);const p=card._targetPos.get('1');assert.ok(p[0]>0&&p[0]<100);
 card._animate(300);assert.ok(segments.some(s=>s.class==='trail'));assert.ok(card._trails.get('1').length>=2);
 card._desiredTargets.clear();card._animate(9000);assert.equal(card._trails.size,0);
});
test('drawing and vertex dragging retain raw coordinates under both flips',()=>{
 const {card}=load();for(const flip_x of [false,true])for(const flip_y of [false,true]){
 card.setConfig({entity_prefix:'sensor.office_',flip_x,flip_y});card._drawing=true;card._draft=[];
 card._svgPoint=()=>card._transform(1,2);card._pointerDown({button:0,target:{getAttribute:()=>null},preventDefault(){}});
 assert.ok(Math.abs(card._draft[0][0]-1)<1e-9&&Math.abs(card._draft[0][1]-2)<1e-9);
 card._drawing=false;card._pointerDown({button:0,target:{getAttribute:()=> '0'},preventDefault(){}});
 card._svgPoint=()=>card._transform(-1,3);card._pointerMove({preventDefault(){}});card._pointerUp();
 assert.equal(card._serialize(card._draft),'-1000:3000');assert.equal(card._drag,-1);
 }});
test('display settings validate independently and retain asymmetric geometry',()=>{
 const {card}=load();
 for(const values of [{display_start_angle:30,display_end_angle:20},{display_min_range:6},{display_min_range:-1},{display_end_angle:61},{display_size:'huge'},{display_start_angle:NaN}])assert.throws(()=>card.setConfig({entity_prefix:'sensor.office_',...values}));
 card.setConfig({entity_prefix:'sensor.office_',display_start_angle:-15,display_end_angle:55,display_min_range:1,fov_range:4,display_size:'full'});
 assert.equal(card.getGridOptions().columns,'full');
 const arc=card._sectorPoints(4,-15,55);
 assert.ok(Math.abs(card._inverse(...arc[0])[0]-4*Math.sin(-Math.PI/12))<1e-9);
 assert.ok(Math.abs(card._inverse(...arc[64])[0]-4*Math.sin(55*Math.PI/180))<1e-9);
});
test('default viewport fits full six metre fan horizontally with equal axis scale',()=>{
 const {card}=load();card.setConfig({entity_prefix:'sensor.office_'});
 const points=card._sectorPoints(6,-60,60);assert.ok(points.every(([x,y])=>x>=-144&&x<=504&&y>=12&&y<=348));
 assert.ok(Math.abs((card._transform(1,0)[0]-card._transform(0,0)[0])-(card._transform(0,0)[1]-card._transform(0,1)[1]))<1e-9);
});
