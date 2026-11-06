const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('dist/jarvis-room-configurator.js','utf8');
function load(extra={}){const c=vm.createContext({HTMLElement:class{},customElements:{get:()=>true},window:{customCards:[]},...extra});vm.runInContext(source,c);return code=>vm.runInContext(code,c);}
const decode=v=>JSON.parse(JSON.stringify(v));
test('real office naming stem and different kitchen prefix discover every slot without mixing rooms',()=>{
 const run=load();run(`var states={};for(const prefix of ['kantoor_jarvis_roomnode_esp_test_tracking_','jarvis_roomnode_keuken_tracking_'])for(const n of [1,2,3,4,5])for(const axis of ['x','y'])states['sensor.'+prefix+'target_'+n+'_'+axis]={};var hass={states};`);
 const r=run(`floorDiscover(hass,{source_entity:'sensor.kantoor_jarvis_roomnode_esp_test_tracking_target_1_x'})`);
 assert.equal(r.targets.length,5);assert.ok(r.targets.every(t=>t.x_entity.includes('kantoor')));
 assert.equal(run(`floorDiscover(hass,{source_entity:'sensor.jarvis_roomnode_keuken_tracking_target_3_y'}).targets.length`),5);
});
test('device registry original names find renamed coordinates, polygons and occupancy; disabled entities excluded',()=>{
 const run=load();run(`var entities=[
 {entity_id:'sensor.renamed_x',device_id:'office',original_name:'Tracking Target 1 X'},
 {entity_id:'sensor.renamed_y',device_id:'office',original_name:'Tracking Target 1 Y'},
 {entity_id:'sensor.kitchen_x',device_id:'kitchen',original_name:'Tracking Target 1 X'},
 {entity_id:'sensor.disabled',device_id:'office',original_name:'Tracking Target 1 X',disabled_by:'user'},
 {entity_id:'text.renamed',device_id:'office',original_name:'Polygon Zone 1'},
 {entity_id:'binary_sensor.renamed',device_id:'office',original_name:'Occupancy'},
 {entity_id:'sensor.count',device_id:'office',original_name:'Polygon Zone 1 Target Count'}];var hass={states:{}};`);
 const r=run(`floorDiscover(hass,{source_entity:'sensor.renamed_x'},{entities})`);
 assert.deepEqual(decode(r.targets),[{id:1,x_entity:'sensor.renamed_x',y_entity:'sensor.renamed_y'}]);assert.equal(r.polygons['zone:1'],'text.renamed');assert.equal(r.occupancy,'binary_sensor.renamed');assert.equal(r.counts[1],'sensor.count');assert.equal(r.warnings.length,0);
});
test('duplicate and incomplete axes are diagnosed and never guessed',()=>{
 const run=load();const r=run(`floorDiscover({states:{}},{device_id:'office'},{entities:[
 {entity_id:'sensor.a',device_id:'office',original_name:'Target 1 X'},
 {entity_id:'sensor.b',device_id:'office',original_name:'Target 1 X'},
 {entity_id:'sensor.c',device_id:'office',original_name:'Target 1 Y'},
 {entity_id:'sensor.d',device_id:'office',original_name:'Target 2 X'}]})`);
 assert.equal(r.targets.length,0);assert.match(r.warnings.join(' '),/Ambiguous target:1:x/);assert.match(r.warnings.join(' '),/Target 2/);
});
test('registry access failures provide fallback, no broad scan for renamed anchors',async()=>{
 const run=load();const result=await run(`var calls=0;var hass={connection:{},callWS:()=>{calls++;return Promise.reject(Error('forbidden'));}};floorRegistries(hass)`);
 assert.equal(result.limited,true);await run('floorRegistries(hass)');assert.equal(run('calls'),2);
 assert.match(run(`floorDiscover({states:{}},{device_id:'a'},${JSON.stringify(result)}).warnings.join(' ')`),/registry unavailable/);
 assert.equal(run(`floorDiscover({states:{'sensor.other_target_1_x':{}}},{source_entity:'sensor.renamed'}).targets.length`),0);
});
test('legacy import preserves asymmetric sector, flips, smoothing and rollback source',()=>{
 const run=load();const c=run(`floorConvertLegacy({...floorDefaults(),future:{keep:42}},'kantoor',{type:'custom:jarvis-target-card',entity_prefix:'sensor.kantoor_',flip_x:true,flip_y:true,smoothing_ms:250,trail_seconds:12,display_start_angle:-25,display_end_angle:50,range:10,custom_option:'keep'})`);
 assert.equal(c.future.keep,42);assert.equal(c.hardware.kantoor.flip_x,true);assert.equal(c.hardware.kantoor.legacy_card.custom_option,'keep');assert.equal(c.placements[0].fov_start,-25);assert.equal(c.placements[0].trail_seconds,12);assert.equal(c.placements[0].smoothing_ms,250);
 assert.equal(c.placements[1].yaw,90);
});
test('visual scale composes with all headings and mirrors without changing source coordinates',()=>{
 const run=load();assert.ok(Math.abs(run(`Math.hypot(...floorProject({x:0,y:0,yaw:47,scale:2},{flip_x:true,flip_y:true},3,4))`)-10)<1e-10);
});
test('two sensors smooth independently, bound samples, fade lost trails and reset reused IDs',()=>{
 const run=load();run(`var tracks=new Map(),desired=new Map([['a',{point:[0,0],smoothing:180,duration:8000,color:'red'}],['b',{point:[5,0],smoothing:0,duration:8000,color:'blue'}]]);floorStep(tracks,desired,0,0);desired.get('a').point=[1,0];desired.get('b').point=[6,0];floorStep(tracks,desired,100,100);`);
 assert.ok(run(`tracks.get('a').point[0]>0&&tracks.get('a').point[0]<1`));assert.equal(run(`tracks.get('b').point[0]`),6);
 run(`desired.delete('a');floorStep(tracks,desired,200,100)`);assert.equal(run(`tracks.get('a').active`),false);
 run(`desired.set('a',{point:[8,8],smoothing:180,duration:8000});floorStep(tracks,desired,300,100)`);assert.equal(run(`tracks.get('a').point[0]`),8);assert.equal(run(`tracks.get('a').trail.length`),1);
 run(`for(let i=1;i<1000;i++){desired.get('a').point=[i,i];floorStep(tracks,desired,300+i,1);}`);assert.ok(run(`tracks.get('a').trail.length<=120`));
 run(`desired.clear();floorStep(tracks,desired,20000,100)`);assert.equal(run('tracks.size'),0);
});
