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
  card.setConfig({entity_prefix:'sensor.office_'});
  return {card,context,registry};
}
const state=(value,unit)=>({state:String(value),attributes:{unit_of_measurement:unit}});
test('loads without backend, imports or network; registration is idempotent',()=>{
 const {context,registry}=load();vm.runInContext(`{${source}}`,context);
 assert.equal(registry.size,1);assert.equal(context.window.customCards.length,1);
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
