/* Jarvis Room Configurator v0.7.0 - LD2460 local-coordinate zone editor.
 * Own implementation; no third-party frontend source code copied.
 * Zone data is stored by ESPHome text entities (mm), not by this card.
 */
// All display fields are independent of device entities and polygon coordinates.
const displayFields=[
 ['display_start_angle','Left boundary (°, radar-local)',-60,60,1],
 ['display_end_angle','Right boundary (°, radar-local)',-60,60,1],
 ['display_min_range','Minimum distance (m)',0,6,.1],
 ['fov_range','Maximum distance (m)',.1,6,.1],
 ['range','Viewport scale (m)',1,30,.1]
];
function validateDisplay(c){
 for(const [key,,min,max] of displayFields){const v=c[key];if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(`${key} must be ${min}..${max}`);}
 if(c.display_start_angle>=c.display_end_angle)throw Error('Left angle must be less than right angle.');
 if(c.display_min_range>=c.fov_range)throw Error('Minimum distance must be less than maximum distance.');
 if(!['standard','large','full'].includes(c.display_size))throw Error('Invalid display size.');
}
function displayControls(root,config,onChange){
 root.innerHTML='<p>Schematic display only. Does not program LD2460 or change occupancy polygons. Angles: 0° forward, positive toward +X; flips mirror the drawing.</p>';
 for(const [key,label,min,max,step] of displayFields){
  const row=document.createElement('label');row.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0';row.textContent=label+' ';
  const number=document.createElement('input'),slider=document.createElement('input');
  for(const [input,type] of [[number,'number'],[slider,'range']]){input.type=type;input.min=min;input.max=max;input.step=step;input.value=config[key];input.setAttribute('aria-label',label+(type==='range'?' slider':''));row.append(input);}
  number.style.width='85px';slider.style.cssText='width:140px;max-width:100%';root.append(row);
  for(const input of [number,slider])input.oninput=()=>{number.value=slider.value=input.value;commit(key,input.value===''?NaN:Number(input.value));};
 }
 const size=document.createElement('select');size.setAttribute('aria-label','Display size');
 for(const value of ['standard','large','full']){const o=document.createElement('option');o.value=value;o.textContent=value;size.append(o);}size.value=config.display_size;root.append(size);
 size.onchange=()=>commit('display_size',size.value);
 const error=document.createElement('p');error.setAttribute('role','status');root.append(error);
 let draft={...config};
 function commit(key,value){draft={...draft,[key]:value};try{validateDisplay(draft);error.textContent='';onChange({...draft});}catch(e){error.textContent=e.message;}}
}
class JarvisTargetCard extends HTMLElement {
  constructor() { super(); this.attachShadow({mode:'open'}); this._draft = null; this._selection='zone:1'; this._drawing=false; this._drag=-1; this._targetPos=new Map(); this._trails=new Map(); this._lastFrame=0; this._raf=0; this._pendingStatus=false; }
  setConfig(config) {
    if (typeof config.entity_prefix !== 'string' || !config.entity_prefix.startsWith('sensor.')) throw new Error('entity_prefix must start with sensor.');
    this._config={title:'Jarvis — LD2460',range:6,flip_x:false,flip_y:false,smoothing_ms:180,trail_seconds:8,show_fov:true,fov_range:6,fov_angle:120,display_start_angle:-(config.fov_angle??120)/2,display_end_angle:(config.fov_angle??120)/2,display_min_range:0,display_size:'standard',...config};
    if (!Number.isFinite(+this._config.range)||+this._config.range<=0) throw new Error('range must be positive');
    if (!Number.isFinite(+this._config.smoothing_ms)||+this._config.smoothing_ms<0||+this._config.smoothing_ms>2000) throw new Error('smoothing_ms must be 0..2000');
    if (!Number.isFinite(+this._config.trail_seconds)||+this._config.trail_seconds<0||+this._config.trail_seconds>60) throw new Error('trail_seconds must be 0..60');
    for(const [key,max] of [['fov_range',6],['fov_angle',120]]) if(typeof this._config[key] !== 'number'||!Number.isFinite(this._config[key])||this._config[key]<=0||this._config[key]>max) throw new Error(`${key} must be >0 and <=${max}`);
    if(typeof this._config.show_fov !== 'boolean') throw new Error('show_fov must be boolean');
    validateDisplay(this._config);
    this._trails.clear(); this._targetPos.clear();
    for (const key of ['flip_x','flip_y']) if (typeof this._config[key] !== 'boolean') throw new Error(`${key} must be boolean`);
    this._build(); if(this._hass) this._render();
  }
  set hass(hass) { this._hass=hass; if (this._config) this._render(); }
  connectedCallback(){ if(this._config&&!this._raf) this._animate(0); }
  disconnectedCallback(){ if(this._raf) cancelAnimationFrame(this._raf); this._raf=0; }
  static getConfigElement(){return document.createElement('jarvis-target-card-editor');}
  getCardSize(){ return this._config?.display_size==='standard'?12:16; }
  getGridOptions(){return {columns:this._config?.display_size==='full'?'full':12,rows:'auto',min_columns:6};}
  _build(){
    this.shadowRoot.innerHTML=`<style>
      :host{display:block;min-width:0}ha-card{display:block;padding:16px;box-sizing:border-box}details{margin:12px 0}input,select{font:inherit}input[type=range]{vertical-align:middle}  h3{margin:0 0 8px;font-size:18px} svg{width:100%;display:block;touch-action:none;background:var(--secondary-background-color,#f5f5f5);border-radius:8px;cursor:crosshair}
      .fov-layer{pointer-events:none}.hardware-fov{fill:#0891b2;fill-opacity:.08;stroke:#0891b2;stroke-width:1.5}.fov-arc,.fov-direction{fill:none;stroke:#0891b2;stroke-opacity:.55;stroke-width:1;stroke-dasharray:3 4}.configured-sector{fill:none;stroke:#64748b;stroke-width:2;stroke-dasharray:7 4}
      .grid{stroke:var(--divider-color,#bbb);stroke-width:.6}.label{fill:var(--primary-text-color,#111);font-size:12px}.target{fill:#eca923;stroke:#222;stroke-width:1.2}.trail{fill:none;stroke:#eab308;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
      polygon.zone{fill-opacity:.15;stroke-width:2}polygon.zone.occupied{fill-opacity:.30;stroke-width:3}polygon.exclusion{fill:#e35b5b;fill-opacity:.15;stroke:#e35b5b;stroke-width:2;stroke-dasharray:5 3} .legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px 12px;margin:10px 0;font-size:12px}.legend-item{display:flex;align-items:center;gap:7px}.swatch{width:13px;height:13px;border-radius:3px;flex:none;border:1px solid currentColor}.legend .fov-info{grid-column:1 / -1}.legend small{color:var(--secondary-text-color,#666)}
      .vertex{fill:#fff;stroke:#227db5;stroke-width:2;cursor:move}.tools{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;align-items:center}select,button{font:inherit;padding:5px 8px}button:disabled{opacity:.45}
      .status{font-size:12px;color:var(--secondary-text-color,#666);margin-top:8px;overflow-wrap:anywhere}.error{color:#c83737}.active{background:#2d7d97;color:white}
    </style><ha-card><h3></h3><details><summary>Display sector settings</summary><div id="display-controls"></div><p>Preview only here. To retain changes, use Edit dashboard → Edit card → Display settings, then Save.</p></details><div class="tools"><label>Zone <select id="zone"></select></label><button id="draw">Draw new</button><button id="finish">Finish</button><button id="clear">Clear</button><button id="reload">Reload</button><button id="save">Apply to ESPHome</button></div><svg viewBox="-156 0 672 360" role="img" aria-label="LD2460 radar field of view, live targets and polygon editor"></svg><div class="legend" id="legend" aria-live="polite"></div><div class="status" id="status"></div></ha-card>`;
    const svgSize={standard:760,large:1100,full:1600}[this._config.display_size];
    this.shadowRoot.querySelector('svg').style.cssText=`max-width:${svgSize}px;margin:auto`;
    displayControls(this.shadowRoot.querySelector('#display-controls'),this._config,c=>{
      if(c.range!==this._config.range){this._trails.clear();this._targetPos.clear();}
      this._config=c;
      this.shadowRoot.querySelector('svg').style.maxWidth={standard:760,large:1100,full:1600}[c.display_size]+'px';
      this._render();
    });
    this.shadowRoot.querySelector('h3').textContent=this._config.title;
    const select=this.shadowRoot.querySelector('#zone');
    for(let kind of ['zone','exclusion']) for(let n=1;n<=(kind==='zone'?4:2);n++){const option=document.createElement('option');option.value=`${kind}:${n}`;option.textContent=`${kind==='zone'?'Detection':'Exclusion'} ${n}`;select.append(option);}
    select.value=this._selection;
    select.addEventListener('change',()=>{this._selection=select.value;this._draft=null;this._drawing=false;this._pendingStatus=false;this._render();});
    this.shadowRoot.querySelector('#draw').onclick=()=>{this._draft=[];this._drawing=true;this._status('Click to add vertices; Finish when at least 3 points.');this._render();};
    this.shadowRoot.querySelector('#finish').onclick=()=>{if(this._drawing&&this._draft.length>=3){this._drawing=false;this._status('Polygon ready. Apply to ESPHome to save.');} else this._status('At least 3 vertices are required.',true);this._render();};
    this.shadowRoot.querySelector('#clear').onclick=()=>{this._draft=[];this._drawing=false;this._status('Polygon cleared in preview; Apply to save.');this._render();};
    this.shadowRoot.querySelector('#reload').onclick=()=>{this._draft=null;this._drawing=false;this._pendingStatus=false;this._render();};
    this.shadowRoot.querySelector('#save').onclick=()=>this._apply();
    const svg=this.shadowRoot.querySelector('svg');
    svg.addEventListener('pointerdown',e=>this._pointerDown(e));
    svg.addEventListener('pointermove',e=>this._pointerMove(e));
    svg.addEventListener('pointerup',()=>this._pointerUp());
    svg.addEventListener('pointercancel',()=>this._pointerUp());
  }
  _prefix(){return this._config.entity_prefix.slice('sensor.'.length).toLowerCase();}
  _zoneId(kind,n){
    const suffix=kind==='zone'?`polygon_zone_${n}`:`polygon_exclusion_${n}`;
    const match=Object.keys(this._hass?.states||{}).filter(id=>id.startsWith(`text.${this._prefix()}`)&&id.endsWith(suffix));
    return match.length===1?match[0]:null;
  }
  _zoneCount(n){
    // Prefer a unique, firmware-reported count. Never infer occupancy from the display.
    const prefix=this._prefix();
    const suffixes=[`polygon_zone_${n}_target_count`,`zone_${n}_target_count`];
    for(const suffix of suffixes){
      const matches=Object.keys(this._hass?.states||{}).filter(id=>id.startsWith(`sensor.${prefix}`)&&id.endsWith(suffix));
      if(matches.length!==1)continue;
      const raw=this._hass.states[matches[0]].state;
      const count=Number(raw);
      return Number.isInteger(count)&&count>=0&&raw!==''?count:null;
    }
    return null;
  }
  _updateLegend(zones){
    const legend=this.shadowRoot.querySelector('#legend');
    if(!legend)return;
    legend.replaceChildren();
    for(const z of zones){
      const item=document.createElement('div');item.className='legend-item';
      const swatch=document.createElement('span');swatch.className='swatch';swatch.style.backgroundColor=z.color;
      const label=document.createElement('span');
      label.textContent=z.kind==='zone'?`Detection ${z.n}: ${z.count===null?'count unavailable':z.count+' target(s)'}`:`Exclusion ${z.n}`;
      item.append(swatch,label);legend.append(item);
    }
    if(this._config.show_fov){const info=document.createElement('small');info.className='fov-info';info.textContent=this._fovDescription();legend.append(info);}
    if(!zones.length){const info=document.createElement('small');info.textContent='No configured polygons found';legend.append(info);}
  }
  _parse(value){
    if(!value||['unknown','unavailable'].includes(value)) return [];
    if(!/^-?\d+:-?\d+(;-?\d+:-?\d+)*$/.test(value)) return null;
    const pts=value.split(';').map(pair=>pair.split(':').map(Number).map(v=>v/1000));
    return pts.length<=20?pts:null;
  }
  _serialize(pts){return pts.map(p=>`${Math.round(p[0]*1000)}:${Math.round(p[1]*1000)}`).join(';');}
  _transform(x,y){const range=+this._config.range,scale=290/range;return [180+(this._config.flip_x?-1:1)*x*scale,(this._config.flip_y?34:326)+(this._config.flip_y?1:-1)*y*scale];}
  _inverse(px,py){const scale=290/(+this._config.range);return [(px-180)/((this._config.flip_x?-1:1)*scale),(py-(this._config.flip_y?34:326))/((this._config.flip_y?1:-1)*scale)];}
  _svgPoint(e){const svg=this.shadowRoot.querySelector('svg');const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const ctm=svg.getScreenCTM();if(!ctm)return null;const p=pt.matrixTransform(ctm.inverse());return [p.x,p.y];}
  _draftPoints(){if(this._draft!==null)return this._draft;const [kind,num]=this._selection.split(':');const id=this._zoneId(kind,+num);return this._parse(id?this._hass.states[id].state:'')||[];}
  _pointerDown(e){if(e.button!==0)return;const loc=this._svgPoint(e);if(!loc)return;
    const index=e.target?.getAttribute?.('data-vertex');
    if(index!==null&&index!==undefined){this._drag=+index;if(this._draft===null)this._draft=this._draftPoints().map(p=>[...p]);e.preventDefault();return;}
    if(!this._drawing)return;
    const [x,y]=this._inverse(...loc);
    if(y<0||!Number.isFinite(x)||!Number.isFinite(y)){this._status('Draw in front of radar (positive Y).',true);return;}
    if(this._draft.length>=20){this._status('Maximum 20 vertices.',true);return;}
    this._draft.push([x,y]);this._render();e.preventDefault();
  }
  _pointerMove(e){if(this._drag<0)return;const loc=this._svgPoint(e);if(!loc)return;const [x,y]=this._inverse(...loc);if(y<0)return;this._draft[this._drag]=[x,y];this._render();e.preventDefault();}
  _pointerUp(){this._drag=-1;}
  _status(message,error=false){this._pendingStatus=true;const s=this.shadowRoot.querySelector('#status');if(s){s.textContent=message;s.classList.toggle('error',error);}}
  async _apply(){if(!this._hass||this._drawing){this._status('Finish drawing before saving.',true);return;}
    const [kind,n]=this._selection.split(':');const id=this._zoneId(kind,+n);if(!id){this._status('Matching ESPHome text entity not found or ambiguous. Check prefix and zone package.',true);return;}
    const pts=this._draftPoints();if(pts.length!==0&&(pts.length<3||pts.length>20)){this._status('Polygon must have 3 to 20 points.',true);return;}
    const value=this._serialize(pts);const button=this.shadowRoot.querySelector('#save');button.disabled=true;
    try{await this._hass.callService('text','set_value',{entity_id:id,value});this._draft=null;this._status(`Sent to ${id}. Confirm the entity state matches the polygon; ESPHome reports optimistically.`);}
    catch(err){this._status(`Could not save: ${err.message||err}`,true);}finally{button.disabled=false;this._render();}
  }
  _el(svg,tag,attrs={},txt){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(txt!==undefined)el.textContent=txt;svg.append(el);return el;}
  // Radar-local coordinates: origin (0,0), forward +Y, positive angle toward +X.
  // Sample curves in metres, then use the same transform as targets and polygons.
  _sectorPoints(distance,start,end){
    return Array.from({length:65},(_,i)=>{const a=(start+(end-start)*i/64)*Math.PI/180;return this._transform(distance*Math.sin(a),distance*Math.cos(a));});
  }
  _radarEntity(domain,suffix){
    const ids=Object.keys(this._hass?.states||{}).filter(id=>id.startsWith(`${domain}.${this._prefix()}`)&&id.endsWith(suffix));
    return ids.length===1?this._hass.states[ids[0]]:null;
  }
  _configuredSector(){
    const values=['distance','start_angle','end_angle'].map((key,i)=>{
      const s=this._radarEntity('number',`tracking_radar_detection_${key}`);
      if(!s||String(s.state).trim()===''||!Number.isFinite(Number(s.state)))return NaN;
      const unit=s.attributes?.unit_of_measurement;
      const factor=i===0?({m:1,cm:.01,mm:.001}[unit]):unit==='°'?1:undefined;
      return factor===undefined?NaN:Number(s.state)*factor;
    });
    const [distance,start,end]=values;
    return distance>0&&distance<=6&&start>=-60&&end<=60&&start<end?{distance,start,end}:null;
  }
  _sideMount(){
    const mode=this._radarEntity('select','tracking_radar_installation_mode');
    const ids=Object.keys(this._hass?.states||{}).filter(id=>id.startsWith(`select.${this._prefix()}`)&&id.endsWith('tracking_radar_installation_mode'));
    return ids.length===0||(ids.length===1&&mode?.state==='side');
  }
  _fovDescription(){
    if(!this._sideMount())return 'Radar FOV hidden: mounting mode unavailable or not Side; ceiling projection is unsupported.';
    const c=this._configuredSector();
    return `Cyan: schematic display sector ${this._config.display_min_range}–${this._config.fov_range} m / ${this._config.display_start_angle}° to ${this._config.display_end_angle}°, forward +Y (not guaranteed coverage). Dashed grey: ${c?`ESPHome radar limits ${c.distance} m, ${c.start}° to ${c.end}°`:'radar limits unavailable or ambiguous'}. Polygons are separate occupancy zones. View may crop coverage; range sets display scale only.`;
  }
  _drawFov(svg){
    if(!this._config.show_fov||!this._sideMount())return;
    const layer=this._el(svg,'g',{'data-layer':'fov',class:'fov-layer','pointer-events':'none'});
    const el=(tag,attrs,txt)=>this._el(layer,tag,attrs,txt);
    const origin=this._transform(0,0);
    const path=(r,a,b,closed=false)=>`${closed?'M '+origin.join(' ')+' L ':'M '}${this._sectorPoints(r,a,b).map(p=>p.join(' ')).join(' L ')}${closed?' Z':''}`;
    const radius=this._config.fov_range,start=this._config.display_start_angle,end=this._config.display_end_angle;
    const outer=this._sectorPoints(radius,start,end),inner=this._sectorPoints(this._config.display_min_range,start,end).reverse();
    el('path',{d:'M '+[...outer,...inner].map(p=>p.join(' ')).join(' L ')+' Z',class:'hardware-fov'});
    for(let r=Math.max(1,Math.ceil(this._config.display_min_range));r<=radius;r++){
      el('path',{d:path(r,start,end),class:'fov-arc'});
      const [x,y]=this._transform(0,r);
      el('text',{x:x+4,y:y-4,class:'label'},`${r} m`);
    }
    const tip=this._transform(0,Math.min(radius,.45));
    el('line',{x1:origin[0],y1:origin[1],x2:tip[0],y2:tip[1],class:'fov-direction'});
    const arrow=[[-.08,Math.min(radius,.45)-.12],[0,Math.min(radius,.45)],[.08,Math.min(radius,.45)-.12]].map(p=>this._transform(...p).join(',')).join(' ');
    el('polyline',{points:arrow,class:'fov-direction'});
    const configured=this._configuredSector();
    if(configured)el('path',{d:path(configured.distance,configured.start,configured.end,true),class:'configured-sector'});
  }
  _readTargets(){const prefix=this._config.entity_prefix.toLowerCase();const pairs=new Map();for(const [id,state] of Object.entries(this._hass?.states||{})){
      if(!id.startsWith(prefix))continue;const m=id.match(/^(.*(?:tracking_)?target_([1-5]))_(x|y)$/);if(!m)continue;if(!pairs.has(m[2]))pairs.set(m[2],{});pairs.get(m[2])[m[3]]=state;
    }
    let found=0;const coords=new Map();for(const [id,axes] of pairs){if(!axes.x||!axes.y)continue;found++;
      const convert=s=>{const n=Number(s.state),unit=(s.attributes.unit_of_measurement||'').toLowerCase();return ['unknown','unavailable',''].includes(s.state)||!Number.isFinite(n)?NaN:unit==='mm'?n/1000:unit==='cm'?n/100:unit==='m'?n:NaN;};
      const x=convert(axes.x),y=convert(axes.y);if(!Number.isFinite(x)||!Number.isFinite(y)||y<0||(x===0&&y===0))continue;coords.set(id,this._transform(x,y));
    }return {coords,found};
  }
  _render(){const svg=this.shadowRoot.querySelector('svg');if(!svg||!this._hass)return;svg.replaceChildren();const el=(tag,attrs,txt)=>this._el(svg,tag,attrs,txt);
    const range=+this._config.range;for(let i=-Math.floor(range);i<=Math.floor(range);i++){const [px]=this._transform(i,0);if(px>=-144&&px<=504)el('line',{x1:px,y1:12,x2:px,y2:348,class:'grid'});}
    for(let i=0;i<=Math.floor(range);i++){const [,py]=this._transform(0,i);if(py>=12&&py<=348)el('line',{x1:-144,y1:py,x2:504,y2:py,class:'grid'});}
    this._drawFov(svg);
    const palette=['#16a34a','#2563eb','#a855f7','#ea580c'];
    const legendZones=[];
    for(const kind of ['zone','exclusion'])for(let n=1;n<=(kind==='zone'?4:2);n++){
      const id=this._zoneId(kind,n);const selected=this._selection===`${kind}:${n}`;
      const pts=selected&&this._draft!==null?this._draft:this._parse(id?this._hass.states[id].state:'');
      if(!pts||!pts.length)continue;
      const count=kind==='zone'?this._zoneCount(n):null;
      const color=kind==='zone'?palette[n-1]:'#e35b5b';
      legendZones.push({kind,n,count,color});
      const points=pts.map(([x,y])=>this._transform(x,y).join(',')).join(' ');
      if(pts.length>=3)el('polygon',{points,class:kind+(count>0?' occupied':''),style:kind==='zone'?`fill:${color};stroke:${color}`:''});
      else el('polyline',{points,fill:'none',stroke:color,'stroke-width':2});
      if(selected)pts.forEach(([x,y],i)=>{const [px,py]=this._transform(x,y);el('circle',{cx:px,cy:py,r:5,class:'vertex','data-vertex':i});});
    }
    this._updateLegend(legendZones);
    const [cx,cy]=this._transform(0,0);el('circle',{cx,cy,r:6,fill:'#0d9488'});el('text',{x:cx+10,y:cy+(this._config.flip_y?18:-8),class:'label'},'Radar');
    const {coords,found}=this._readTargets();this._desiredTargets=coords;this._found=found;
    const layer=el('g',{'data-layer':'targets'});this._targetLayer=layer;
    for(const [id,point] of coords){if(!this._targetPos.has(id))this._targetPos.set(id,[...point]);const [x,y]=this._targetPos.get(id);this._makeTarget(layer,id,x,y);}
    for(const id of [...this._targetPos.keys()])if(!coords.has(id))this._targetPos.delete(id);
    const [kind,n]=this._selection.split(':');const resolved=this._zoneId(kind,+n);this.shadowRoot.querySelector('#save').disabled=!resolved||this._drawing;
    this.shadowRoot.querySelector('#draw').classList.toggle('active',this._drawing);
    if(!this._drawing&&!this._pendingStatus){const status=this.shadowRoot.querySelector('#status');status.textContent=`${coords.size} target(s) visible · ${found} X/Y pairs · ${resolved||'Zone text entity not found'} · Drag blue vertices; Draw new to replace polygon.`;}
  }
  _makeTarget(parent,id,x,y){const el=(tag,attrs,text)=>{const o=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))o.setAttribute(k,v);if(text)o.textContent=text;parent.append(o);};if(x<-144||x>504||y<12||y>348)return;el('circle',{cx:x,cy:y,r:7,class:'target'});el('text',{x:x+10,y:y-8,class:'label'},`T${id}`);}
  _drawTrail(layer,points,now,duration){
    if(points.length<2)return;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];
      const opacity=Math.max(0,1-(now-b.t)/duration)*0.75;
      if(opacity<0.01)continue;
      this._el(layer,'line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'trail',opacity});
    }
  }
  _animate(timestamp){
    if(!this.isConnected){this._raf=0;return;}
    const dt=Math.min(100,Math.max(0,timestamp-(this._lastFrame||timestamp)));
    this._lastFrame=timestamp;
    const alpha=this._config.smoothing_ms===0?1:1-Math.exp(-dt/(+this._config.smoothing_ms));
    const duration=this._config.trail_seconds*1000;
    if(this._desiredTargets&&this._targetLayer){
      this._targetLayer.replaceChildren();
      for(const [id,p] of this._desiredTargets){
        const old=this._targetPos.get(id)||p;
        const next=[old[0]+alpha*(p[0]-old[0]),old[1]+alpha*(p[1]-old[1])];
        this._targetPos.set(id,next);
        if(duration>0){
          let trail=this._trails.get(id);
          if(!trail){trail=[];this._trails.set(id,trail);}
          const last=trail[trail.length-1];
          // Record only meaningful movement, reducing drawing cost and jitter.
          if(!last||Math.hypot(next[0]-last.x,next[1]-last.y)>=1.5){
            trail.push({x:next[0],y:next[1],t:timestamp});
          }
          while(trail.length&&timestamp-trail[0].t>duration)trail.shift();
          // Cap stored samples per target, even with unusually frequent updates.
          if(trail.length>240)trail.splice(0,trail.length-240);
          this._drawTrail(this._targetLayer,trail,timestamp,duration);
        }
        this._makeTarget(this._targetLayer,id,...next);
      }
      // Missing targets retain their fading path, but no live target marker.
      for(const [id,trail] of this._trails){
        if(this._desiredTargets.has(id))continue;
        while(trail.length&&timestamp-trail[0].t>duration)trail.shift();
        if(duration===0||trail.length<2){this._trails.delete(id);continue;}
        this._drawTrail(this._targetLayer,trail,timestamp,duration);
      }
    }
    this._raf=requestAnimationFrame(t=>this._animate(t));
  }
}
class JarvisTargetCardEditor extends HTMLElement {
 constructor(){super();this.attachShadow({mode:'open'});}
 setConfig(config){
  if(this._lastEmitted===JSON.stringify(config))return;
  const card=new JarvisTargetCard();card._build=()=>{};card.setConfig(config);
  this.shadowRoot.innerHTML='<h3>Display settings</h3><p>Changes preview alongside this editor. Save the dashboard card to persist them.</p><div></div>';
  displayControls(this.shadowRoot.querySelector('div'),card._config,c=>{
   // Preserve every unrelated option, including grid_options, prefix and flips.
   const next={...config,...c};this._lastEmitted=JSON.stringify(next);
   this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:next},bubbles:true,composed:true}));
  });
 }
}
if(!customElements.get('jarvis-target-card-editor'))customElements.define('jarvis-target-card-editor',JarvisTargetCardEditor);
if(!customElements.get('jarvis-target-card'))customElements.define('jarvis-target-card',JarvisTargetCard);
window.customCards=window.customCards||[];
// Legacy element retained for migration and the integrated polygon tool.

// BEGIN GENERATED FLOOR GEOMETRY (tools/embed-floor-geometry.py)
const jarvisGroundFloor={"units":"m","source_sha256":"6fc7a40c5f05131f868061994e6007c0ce44760628bec3be9dddb71438d8e800","scene":"Scene","plane_z_m":1.2,"coordinate_system":"Blender world XY; +Z up","segments":[[[8.34493637084961,7.680891990661621],[8.34493637084961,9.433292388916016]],[[8.34493637084961,9.433292388916016],[8.34493637084961,11.050891876220703]],[[5.734868049621582,5.451241970062256],[5.734868049621582,4.297275543212891]],[[5.734868049621582,4.297275543212891],[5.734868049621582,4.077471733093262]],[[5.734868049621582,4.07747220993042],[5.734868049621582,3.047144651412964]],[[8.444936752319336,11.150891304016113],[8.444936752319336,11.098891258239746]],[[8.444937705993652,3.2212421894073486],[8.444937705993652,7.027473449707031]],[[8.444936752319336,11.098891258239746],[8.444936752319336,9.294490814208984]],[[8.444936752319336,9.294490814208984],[8.444937705993652,7.027473449707031]],[[3.244936943054199,11.150890350341797],[3.244936943054199,5.08054256439209]],[[3.244936943054199,5.080542087554932],[3.244936943054199,-0.5228553414344788]],[[5.83486795425415,1.877145528793335],[5.83486795425415,1.963684320449829]],[[5.83486795425415,1.963684320449829],[5.83486795425415,1.9771459102630615]],[[5.83486795425415,3.2212421894073486],[5.83486795425415,3.1376752853393555]],[[5.83486795425415,-0.522855281829834],[5.83486795425415,-0.47485509514808655]],[[5.83486795425415,3.047144651412964],[5.83486795425415,3.121757984161377]],[[5.83486795425415,3.121757984161377],[5.83486795425415,3.1376752853393555]],[[5.83486795425415,-0.47485509514808655],[5.83486795425415,0.3415452837944031]],[[5.83486795425415,0.3415452837944031],[5.83486795425415,0.3571452498435974]],[[5.83486795425415,0.3571453094482422],[5.83486795425415,1.0471453666687012]],[[7.564937114715576,6.670891761779785],[7.564937114715576,6.0366740226745605]],[[7.564937114715576,6.0366740226745605],[7.564937114715576,5.451241970062256]],[[8.34493637084961,7.580891132354736],[7.887336730957031,7.580891132354736]],[[7.887336730957031,7.580891132354736],[7.464937210083008,7.580891132354736]],[[7.344936847686768,4.571241855621338],[7.8649373054504395,4.571241855621338]],[[7.8649373054504395,4.571241855621338],[8.344937324523926,4.571241855621338]],[[5.734868049621582,1.0471453666687012],[5.734868049621582,0.417145311832428]],[[5.734868049621582,-0.4228549003601074],[5.734868049621582,0.4171452522277832]],[[7.564937114715576,6.670891761779785],[7.512937068939209,6.670891761779785]],[[7.512937068939209,6.670891761779785],[7.464937210083008,6.670891761779785]],[[5.83486795425415,4.151241779327393],[6.017268180847168,4.151241779327393]],[[6.017268180847168,4.151241779327393],[6.214868068695068,4.151241779327393]],[[5.734868049621582,5.451241970062256],[5.329303741455078,5.451241970062256]],[[5.329303741455078,5.451241970062256],[4.954936981201172,5.451241970062256]],[[6.494936943054199,5.451241970062256],[6.151700973510742,5.451241970062256]],[[6.151700973510742,5.451241970062256],[5.83486795425415,5.451241970062256]],[[3.3449368476867676,5.551241874694824],[3.708936929702759,5.551241874694824]],[[3.708936929702759,5.551241874694824],[4.0449371337890625,5.551241874694824]],[[4.0449371337890625,5.451241970062256],[3.6809370517730713,5.451241970062256]],[[3.6809370517730713,5.451241970062256],[3.3449368476867676,5.451241970062256]],[[7.344936847686768,4.471242427825928],[7.344936847686768,4.523241996765137]],[[7.344936847686768,4.523241996765137],[7.344936847686768,4.571241855621338]],[[7.344936847686768,3.2212421894073486],[7.344936847686768,3.2773396968841553]],[[7.344936847686768,3.56124210357666],[7.344936847686768,3.4364421367645264]],[[7.344936847686768,3.2773396968841553],[7.344936847686768,3.321242094039917]],[[7.344936847686768,3.4364421367645264],[7.344936847686768,3.4338951110839844]],[[7.344936847686768,3.4338951110839844],[7.344936847686768,3.321242094039917]],[[7.444936752319336,3.56124210357666],[7.444936752319336,3.4364421367645264]],[[7.444936752319336,3.4364421367645264],[7.444936752319336,3.321242094039917]],[[4.954936981201172,5.551241874694824],[5.694137096405029,5.551241874694824]],[[5.694137096405029,5.551241874694824],[6.494936943054199,5.551241874694824]],[[4.954868316650391,1.877145528793335],[5.27828311920166,1.877145528793335]],[[5.83486795425415,1.877145528793335],[5.790965557098389,1.877145528793335]],[[5.27828311920166,1.877145528793335],[5.286368370056152,1.877145528793335]],[[4.044868469238281,1.877145528793335],[3.754652976989746,1.877145528793335]],[[5.286368370056152,1.877145528793335],[5.790965557098389,1.877145528793335]],[[3.3449368476867676,1.877145528793335],[3.754652976989746,1.877145528793335]],[[5.83486795425415,3.321242094039917],[5.83486795425415,3.321242094039917]],[[7.344936847686768,4.471242427825928],[7.8649373054504395,4.471242427825928]],[[7.8649373054504395,4.471242427825928],[8.344937324523926,4.471242427825928]],[[5.83486795425415,3.2212421894073486],[5.83486795425415,3.2212421894073486]],[[8.34493637084961,7.680891513824463],[7.939336776733398,7.680891513824463]],[[7.564937114715576,7.680891513824463],[7.708937168121338,7.680891513824463]],[[7.939336776733398,7.680891513824463],[7.756937026977539,7.680891513824463]],[[7.708937168121338,7.680891513824463],[7.756937026977539,7.680891513824463]],[[8.344937324523926,4.571241855621338],[8.34493637084961,6.13625955581665]],[[8.34493637084961,6.13625955581665],[8.34493637084961,7.580891132354736]],[[8.344937324523926,3.321242094039917],[8.344937324523926,3.9192423820495605]],[[8.344937324523926,3.9192423820495605],[8.344937324523926,4.471242427825928]],[[6.214868068695068,4.151241779327393],[6.214868068695068,3.719641923904419]],[[6.214868068695068,3.719641923904419],[6.214868068695068,3.321242094039917]],[[7.564937114715576,7.780540943145752],[7.564937114715576,7.728723049163818]],[[7.564937114715576,7.728723049163818],[7.564937114715576,7.680891513824463]],[[7.464937210083008,7.8805413246154785],[7.704936981201172,7.8805413246154785]],[[7.704936981201172,7.8805413246154785],[7.964937210083008,7.8805413246154785]],[[6.434937000274658,3.321242094039917],[6.3406219482421875,3.321242094039917]],[[6.3406219482421875,3.321242094039917],[6.214868068695068,3.321242094039917]],[[5.83486795425415,3.321242094039917],[6.006468296051025,3.321242094039917]],[[6.006468296051025,3.321242094039917],[6.164868354797363,3.321242094039917]],[[7.8649373054504395,7.780540943145752],[7.708937168121338,7.780540943145752]],[[7.708937168121338,7.780540943145752],[7.564937114715576,7.780540943145752]],[[6.164868354797363,4.1012420654296875],[6.006468296051025,4.1012420654296875]],[[6.006468296051025,4.1012420654296875],[5.83486795425415,4.1012420654296875]],[[7.964937210083008,7.680891513824463],[7.912937164306641,7.680891513824463]],[[7.912937164306641,7.680891513824463],[7.8649373054504395,7.680891513824463]],[[7.8649373054504395,7.680891513824463],[7.8649373054504395,7.7327094078063965]],[[7.8649373054504395,7.7327094078063965],[7.8649373054504395,7.780540943145752]],[[6.164868354797363,3.321242094039917],[6.164868354797363,3.726842164993286]],[[6.164868354797363,3.726842164993286],[6.164868354797363,4.1012420654296875]],[[5.83486795425415,4.1012420654296875],[5.83486795425415,3.6956419944763184]],[[5.83486795425415,3.6956419944763184],[5.83486795425415,3.321242094039917]],[[7.748595237731934,3.321242094039917],[7.692821025848389,3.321242094039917]],[[8.344937324523926,3.321242094039917],[8.190839767456055,3.321242094039917]],[[8.190839767456055,3.321242094039917],[8.048595428466797,3.321242094039917]],[[7.692821025848389,3.321242094039917],[7.444936752319336,3.321242094039917]],[[5.83486795425415,5.451241970062256],[5.83486795425415,4.775241851806641]],[[5.83486795425415,4.775241851806641],[5.83486795425415,4.151241779327393]],[[8.444936752319336,11.150891304016113],[8.112136840820312,11.150891304016113]],[[8.112136840820312,11.150891304016113],[8.0023832321167,11.150891304016113]],[[3.244936943054199,11.150890350341797],[3.489018678665161,11.150890350341797]],[[3.704936981201172,11.150890350341797],[3.489018678665161,11.150890350341797]],[[8.0023832321167,11.150891304016113],[7.80493688583374,11.150891304016113]],[[4.7249369621276855,11.150890350341797],[4.938107490539551,11.150890350341797]],[[5.104936599731445,11.150890350341797],[4.938107490539551,11.150890350341797]],[[3.3449368476867676,5.451241970062256],[3.3449368476867676,3.644711971282959]],[[3.3449368476867676,3.644711971282959],[3.3449368476867676,1.9771459102630615]],[[3.3449368476867676,1.877145528793335],[3.3449368476867676,0.681145191192627]],[[3.3449368476867676,0.6811453104019165],[3.3449368476867676,-0.4228549301624298]],[[3.244936943054199,-0.5228553414344788],[4.591701030731201,-0.522855281829834]],[[5.83486795425415,-0.522855281829834],[4.639700889587402,-0.522855281829834]],[[4.639700889587402,-0.522855281829834],[4.591701030731201,-0.522855281829834]],[[3.3449368476867676,11.050890922546387],[3.3449368476867676,8.191073417663574]],[[3.3449368476867676,8.191073417663574],[3.3449368476867676,5.551241874694824]],[[7.464937210083008,7.580891132354736],[7.464937210083008,7.736709117889404]],[[7.464937210083008,7.736709117889404],[7.464937210083008,7.8805413246154785]],[[7.464937210083008,5.551241874694824],[7.464937210083008,6.13346004486084]],[[7.464937210083008,6.13346004486084],[7.464937210083008,6.670891761779785]],[[7.404936790466309,5.551241874694824],[7.4361371994018555,5.551241874694824]],[[7.4361371994018555,5.551241874694824],[7.464937210083008,5.551241874694824]],[[3.3449368476867676,-0.4228549301624298],[4.587701320648193,-0.4228549003601074]],[[4.587700843811035,-0.4228549003601074],[5.734868049621582,-0.4228549003601074]],[[7.564937114715576,5.451241970062256],[7.48173713684082,5.451241970062256]],[[7.48173713684082,5.451241970062256],[7.404936790466309,5.451241970062256]],[[7.80493688583374,11.150891304016113],[7.80493688583374,11.111701965332031]],[[7.80493688583374,11.111701965332031],[7.80493688583374,11.050891876220703]],[[7.404936790466309,5.451241970062256],[7.404936790466309,5.499241828918457]],[[7.404936790466309,5.499241828918457],[7.404936790466309,5.551241874694824]],[[6.494936943054199,5.551241874694824],[6.494936943054199,5.503242015838623]],[[6.494936943054199,5.503242015838623],[6.494936943054199,5.451241970062256]],[[4.954936981201172,5.451241970062256],[4.954936981201172,5.499241828918457]],[[4.954936981201172,5.499241828918457],[4.954936981201172,5.551241874694824]],[[4.0449371337890625,5.551241874694824],[4.0449371337890625,5.499241828918457]],[[4.0449371337890625,5.499241828918457],[4.0449371337890625,5.451241970062256]],[[7.444936752319336,3.56124210357666],[7.392936706542969,3.56124210357666]],[[7.392936706542969,3.56124210357666],[7.344936847686768,3.56124210357666]],[[5.104936599731445,11.050890922546387],[5.104936599731445,11.111701011657715]],[[5.104936599731445,11.111701011657715],[5.104936599731445,11.150890350341797]],[[4.7249369621276855,11.050890922546387],[4.7249369621276855,11.106987953186035]],[[4.7249369621276855,11.106987953186035],[4.7249369621276855,11.150890350341797]],[[3.704936981201172,11.150890350341797],[3.704936981201172,11.106987953186035]],[[3.704936981201172,11.106987953186035],[3.704936981201172,11.050890922546387]],[[4.954868316650391,1.877145528793335],[4.954868316650391,1.9356822967529297]],[[4.954868316650391,1.9356822967529297],[4.954868316650391,1.9771459102630615]],[[4.044868469238281,1.877145528793335],[4.044868469238281,1.9186091423034668]],[[4.044868469238281,1.9186091423034668],[4.044868469238281,1.9771459102630615]],[[5.83486795425415,3.047144651412964],[5.7483296394348145,3.047144651412964]],[[5.7483296394348145,3.047144651412964],[5.734868049621582,3.047144651412964]],[[6.434937000274658,3.321242094039917],[6.434937000274658,3.2773396968841553]],[[6.434937000274658,3.2773396968841553],[6.434937000274658,3.2212421894073486]],[[8.048595428466797,3.2212421894073486],[7.993493556976318,3.2212421894073486]],[[7.993493556976318,3.2212421894073486],[7.748595237731934,3.2212421894073486]],[[7.748595237731934,3.321242094039917],[7.803697109222412,3.321242094039917]],[[7.803697109222412,3.321242094039917],[8.048595428466797,3.321242094039917]],[[5.83486795425415,3.2212421894073486],[6.146903991699219,3.2212421894073486]],[[6.146903991699219,3.2212421894073486],[6.1532721519470215,3.2212421894073486]],[[8.444937705993652,3.2212421894073486],[8.238840103149414,3.2212421894073486]],[[8.048595428466797,3.2212421894073486],[8.238840103149414,3.2212421894073486]],[[6.1532721519470215,3.2212421894073486],[6.434937000274658,3.2212421894073486]],[[7.748595237731934,3.2212421894073486],[7.6718430519104,3.2212421894073486]],[[7.344936847686768,3.2212421894073486],[7.671843528747559,3.2212421894073486]],[[5.83486795425415,1.0471453666687012],[5.790965557098389,1.0471453666687012]],[[5.790965557098389,1.0471453666687012],[5.734868049621582,1.0471453666687012]],[[7.964937210083008,7.8805413246154785],[7.964937210083008,7.776723384857178]],[[7.964937210083008,7.776723384857178],[7.964937210083008,7.680891513824463]],[[5.104936599731445,11.050890922546387],[4.942079544067383,11.050890922546387]],[[3.3449368476867676,11.050890922546387],[3.532136917114258,11.050890922546387]],[[3.532136917114258,11.050890922546387],[3.5359573364257812,11.050890922546387]],[[8.34493637084961,11.050891876220703],[7.971532344818115,11.050891876220703]],[[7.80493688583374,11.050891876220703],[7.971532344818115,11.050891876220703]],[[3.5359573364257812,11.050890922546387],[3.704936981201172,11.050890922546387]],[[4.7249369621276855,11.050890922546387],[4.938107490539551,11.050890922546387]],[[4.942079544067383,11.050890922546387],[4.938107490539551,11.050890922546387]],[[5.83486795425415,1.9771459102630615],[5.821406364440918,1.9771459102630615]],[[5.821406364440918,1.9771459102630615],[5.734868049621582,1.9771459102630615]],[[3.3449368476867676,1.9771459102630615],[3.7089014053344727,1.9771459102630615]],[[4.044868469238281,1.9771459102630615],[3.7089014053344727,1.9771459102630615]],[[5.734868049621582,1.9771459102630615],[5.400582313537598,1.9771459102630615]],[[5.400582313537598,1.9771459102630615],[4.954868316650391,1.9771459102630615]]],"room_polygons":null,"sensors":[],"svg_transform":{"pixels_per_metre":80,"x_px":"85 + (x_m - xmin_m) * 80","y_px":"85 + (ymax_m - y_m) * 80","xmin_m":3.244936943054199,"ymax_m":11.150891304016113,"viewbox":[0,0,590,1120]},"model_bounds_m":[[3.244936943054199,-0.5228553414344788,1.1920928955078125e-07],[8.444937705993652,11.150891304016113,2.5]]};
// END GENERATED FLOOR GEOMETRY

// Floorplan is an independent card. Blender world XY in metres remains canonical.
const floorClone=value=>JSON.parse(JSON.stringify(value));
const floorNumber=(value,min,max,name)=>{
 if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(`${name}: expected ${min}..${max}`);
 return value;
};
const floorDefaults=()=>({
 type:'custom:jarvis-floorplan-card',title:'Begane grond',geometry_id:'begane-grond-v9',
 calibration:{dimensions_confirmed:false},
 placements:[
  {id:'kantoor',name:'Kantoor',x:8.444937705993652-(135-88)/80,y:11.150891304016113-(414-85)/80,yaw:180,mounting:'wall',height:null,tilt:0,calibrated:false,fov_range:6,fov_start:-60,fov_end:60},
  {id:'keuken',name:'Keuken',x:8.444937705993652-(326-88)/80,y:11.150891304016113-(803-85)/80,yaw:90,mounting:'wall',height:null,tilt:0,calibrated:false,fov_range:6,fov_start:-60,fov_end:60}
 ],hardware:{}
});
// Image coordinates are map metres (u right, v down), independent of sensor poses.
function floorImageValidate(image){
 if(image==null)return;
 if(typeof image!=='object'||Array.isArray(image))throw Error('Invalid floorplan image');
 if(typeof image.url!=='string'||image.url.length>2048||!(/^(https:\/\/|\/(?!\/))/.test(image.url))||/[\\\s<>"']/.test(image.url))throw Error('Use a /local/ path or HTTPS image URL');
 const url=new URL(image.url,'https://home-assistant.invalid');
 if(url.username||url.password||! /\.(svg|png|jpe?g)$/i.test(url.pathname))throw Error('Use a direct SVG, PNG or JPG image URL without credentials');
 for(const [key,min,max]of [['width',.1,1000],['height',.1,1000],['x',-1000,1000],['y',-1000,1000],['rotation',-360,360]])floorNumber(image[key],min,max,'image '+key);
}
function floorReplaceImage(config,image){
 floorImageValidate(image);
 return floorValidate({...config,floorplan_image:image,calibration:{...config.calibration,dimensions_confirmed:false}});
}
function floorImageBounds(image){
 if(!image)return [-1.4,-1.3,14.4,7.8];
 const a=image.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 const points=[[0,0],[image.width,0],[0,image.height],[image.width,image.height]].map(([x,y])=>[image.x+x*c-y*s,image.y+x*s+y*c]);
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 return [Math.min(...xs)-.8,Math.min(...ys)-.8,Math.max(...xs)-Math.min(...xs)+1.6,Math.max(...ys)-Math.min(...ys)+1.6];
}
function floorValidate(config){
 const defaults=floorDefaults(),c=floorClone({...defaults,...config});
 floorImageValidate(c.floorplan_image);
 if(c.geometry_id!=='begane-grond-v9')throw Error('Unsupported geometry_id');
 if(!c.calibration||typeof c.calibration.dimensions_confirmed!=='boolean')throw Error('calibration.dimensions_confirmed must be boolean');
 if(!Array.isArray(c.placements)||c.placements.length>16)throw Error('placements: expected at most 16 sensors');
 const ids=new Set();
 for(const s of c.placements){
  if(typeof s.id!=='string'||!/^[a-z][a-z0-9_-]{0,47}$/.test(s.id)||ids.has(s.id))throw Error('Sensor IDs must be unique and stable');
  ids.add(s.id);
  if(typeof s.name!=='string'||s.name.length>100)throw Error('Sensor name must be text (max 100 characters)');
  for(const [key,value,min,max]of [['smoothing_ms',s.smoothing_ms??180,0,2000],['trail_seconds',s.trail_seconds??8,0,60],['scale',s.scale??1,.1,10],['display_min_range',s.display_min_range??0,0,6]])floorNumber(value,min,max,key);
  if((s.display_min_range??0)>=s.fov_range)throw Error('Minimum display distance must be smaller than radius');
  if(s.show_fov!==undefined&&typeof s.show_fov!=='boolean')throw Error('show_fov must be boolean');
  floorNumber(s.x,-1000,1000,'x');floorNumber(s.y,-1000,1000,'y');floorNumber(s.yaw,-360,360,'yaw');
  if(s.height!==null)floorNumber(s.height,0,10,'height');
  floorNumber(s.tilt,-90,90,'tilt');
  if(!['wall','ceiling'].includes(s.mounting)||typeof s.calibrated!=='boolean')throw Error('Invalid mounting/calibrated');
  floorNumber(s.fov_range,.1,6,'fov_range');floorNumber(s.fov_start,-60,60,'fov_start');floorNumber(s.fov_end,-60,60,'fov_end');
  if(s.fov_start>=s.fov_end)throw Error('FOV start must precede end');
 }
 if(!c.hardware||Array.isArray(c.hardware)||typeof c.hardware!=='object')throw Error('hardware must be an object keyed by sensor ID');
 for(const [id,h] of Object.entries(c.hardware)){
  if(!ids.has(id)||!h||typeof h!=='object'||Array.isArray(h))throw Error('hardware must reference a placement');
  for(const k of ['device_id','source_entity','entity_prefix'])if(h[k]!==undefined&&(typeof h[k]!=='string'||h[k].length>255))throw Error('Invalid source');
  for(const k of ['flip_x','flip_y','axes_confirmed'])if(h[k]!==undefined&&typeof h[k]!=='boolean')throw Error(`${k} must be boolean`);
  if(h.mode_entity!==undefined&&(typeof h.mode_entity!=='string'||!/^select\.[a-z0-9_]+$/.test(h.mode_entity)))throw Error('mode_entity must be a select entity ID');
  if(!Array.isArray(h.targets||[])||(h.targets||[]).length>64)throw Error('hardware.targets: expected at most 64 explicit entity pairs');
  const pairs=new Set();
  for(const t of h.targets||[]){
   if(!t||typeof t!=='object')throw Error('Invalid target pair');
   for(const k of ['x_entity','y_entity'])if(typeof t[k]!=='string'||!/^sensor\.[a-z0-9_]+$/.test(t[k]))throw Error('Targets need explicit sensor entity IDs');
   if(t.x_entity===t.y_entity||pairs.has(t.x_entity)||pairs.has(t.y_entity))throw Error('Target entities must be distinct per roomnode');
   pairs.add(t.x_entity);pairs.add(t.y_entity);
  }
 }
 return c;
}
// Annotation registration: three non-collinear model/image landmarks, not compass north.
// Image (u,v) = (85 + 80*(ymax-y), 88 + 80*(xmax-x)).
const floorToMap=([x,y])=>[jarvisGroundFloor.model_bounds_m[1][1]-y,jarvisGroundFloor.model_bounds_m[1][0]-x];
const floorFromMap=([u,v])=>[jarvisGroundFloor.model_bounds_m[1][0]-v,jarvisGroundFloor.model_bounds_m[1][1]-u];
function floorProject(s,h,x,y){
 const a=s.yaw*Math.PI/180,rx=x*(h.flip_x?-1:1)*(s.scale??1),forward=y*(h.flip_y?-1:1)*(s.scale??1);
 // Sensor +X = right, +Y = forward; world yaw 0 = +X, +90 = +Y.
 return [s.x+forward*Math.cos(a)+rx*Math.sin(a),s.y+forward*Math.sin(a)-rx*Math.cos(a)];
}
function floorMetres(state){
 const scale={m:1,cm:.01,mm:.001}[state?.attributes?.unit_of_measurement];
 if(!scale||typeof state.state!=='string'||!state.state.trim())return null;
 const n=Number(state.state);return Number.isFinite(n)?n*scale:null;
}
// Resolve within one device (preferred) or one exact naming stem. Never choose
// the first candidate: duplicate/disabled/missing entities need a visible diagnosis.
const floorRegistryCache=new WeakMap();
function floorRegistries(hass){
 const connection=hass?.connection;if(!connection||!hass.callWS)return Promise.resolve({entities:[],devices:[],limited:true});
 if(!floorRegistryCache.has(connection))floorRegistryCache.set(connection,Promise.allSettled([
  hass.callWS({type:'config/entity_registry/list'}),hass.callWS({type:'config/device_registry/list'})
 ]).then(([e,d])=>({entities:e.status==='fulfilled'?e.value:[],devices:d.status==='fulfilled'?d.value:[],limited:e.status!=='fulfilled',devicesLimited:d.status!=='fulfilled'})));
 return floorRegistryCache.get(connection);
}
const floorWords=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
function floorDiscover(hass,source={},registry={entities:[]}){
 const states=hass?.states||{},entries=registry.entities||[],byId=new Map(entries.map(e=>[e.entity_id,e]));
 const anchor=source.source_entity,entry=byId.get(anchor),device=source.device_id||entry?.device_id;
 let stem=source.entity_prefix?.replace(/^[a-z_]+\./,'');
 if(!device&&anchor&&!/(?:tracking_)?target_\d+_[xy]$/.test(anchor))return {targets:[],polygons:{},counts:{},warnings:['Registry access is required for a renamed source. Choose an original target X/Y entity or restore registry access.']};
 if(!device&&anchor)stem=anchor.replace(/^[^.]+\./,'').replace(/(?:tracking_)?target_\d+_[xy]$/,'');
 const warnings=[];
 if(stem==='')return {targets:[],polygons:{},counts:{},warnings:['Choose a source that isolates one roomnode.']};
 if(!device&&!stem)return {targets:[],polygons:{},counts:{},warnings:['Choose a roomnode device or a target X/Y entity.']};
 if(device&&!entries.length)return {targets:[],polygons:{},counts:{},warnings:['Device registry unavailable. Select a target X/Y entity as fallback.']};
 const ids=device?entries.filter(e=>e.device_id===device&&!e.disabled_by).map(e=>e.entity_id):Object.keys(states).filter(id=>id.split('.')[1].startsWith(stem));
 const candidates=new Map();
 const add=(key,id)=>{if(!candidates.has(key))candidates.set(key,new Set());candidates.get(key).add(id);};
 for(const id of ids){
  const e=byId.get(id),domain=id.split('.')[0];
  const names=[id.split('.')[1],e?.original_name,e?.unique_id,states[id]?.attributes?.friendly_name].map(floorWords);
  for(const name of names){
   let m=name.match(/(?:^|_)target_([1-9]\d*)_([xy])$/);if(m&&domain==='sensor')add(`target:${m[1]}:${m[2]}`,id);
   m=name.match(/(?:^|_)polygon_(zone|exclusion)_([1-9]\d*)$/);if(m&&domain==='text')add(`${m[1]}:${m[2]}`,id);
   m=name.match(/(?:^|_)(?:polygon_)?zone_([1-9]\d*)_target_count$/);if(m&&domain==='sensor')add(`count:${m[1]}`,id);
   if(domain==='binary_sensor'&&/(?:^|_)(?:occupancy|presence|target_present)$/.test(name))add('occupancy',id);
   if(domain==='select'&&name.endsWith('tracking_radar_installation_mode'))add('mode',id);
   if(domain==='number'&&/tracking_radar_detection_(distance|start_angle|end_angle)$/.test(name))add(name.match(/(distance|start_angle|end_angle)$/)[1],id);
  }
 }
 const one=key=>{const a=[...(candidates.get(key)||[])];if(a.length>1)warnings.push(`Ambiguous ${key}: ${a.join(', ')}. Rename or disable the duplicate on this device.`);return a.length===1?a[0]:null;};
 const targets=[],numbers=[...new Set([...candidates.keys()].filter(k=>k.startsWith('target:')).map(k=>+k.split(':')[1]))].sort((a,b)=>a-b);
 for(const n of numbers){const x=one(`target:${n}:x`),y=one(`target:${n}:y`);if(x&&y)targets.push({id:n,x_entity:x,y_entity:y});else warnings.push(`Target ${n}: X/Y pair incomplete or ambiguous. Check enabled ESPHome entities.`);}
 const polygons={},counts={};for(const kind of ['zone','exclusion'])for(let n=1;n<=(kind==='zone'?4:2);n++){const id=one(`${kind}:${n}`);if(id)polygons[`${kind}:${n}`]=id;if(kind==='zone')counts[n]=one(`count:${n}`);}
 if(!targets.length)warnings.push('No target pairs found. Select a target X/Y entity or enable tracking entities in ESPHome.');
 if(!device)warnings.push('Using entity-name fallback; choose a device for renamed entities.');
 return {targets,polygons,counts,occupancy:one('occupancy'),mode_entity:one('mode'),distance:one('distance'),start_angle:one('start_angle'),end_angle:one('end_angle'),warnings};
}
function floorResolve(hass,h,registry){
 const discovered=floorDiscover(hass,h,registry);
 return {...discovered,...h,targets:h.targets?.length?h.targets:discovered.targets,warnings:h.targets?.length&&!h.device_id&&!h.source_entity&&!h.entity_prefix?[]:discovered.warnings};
}
// Frames operate in model metres. Lost IDs have no marker; retained trails fade
// separately, and a reused ID starts a new path rather than joining two people.
function floorStep(tracks,desired,now,dt){
 for(const [key,t]of tracks)if(!desired.has(key))t.active=false;
 for(const [key,d]of desired){
  let t=tracks.get(key);if(!t||!t.active){t={point:[...d.point],trail:[],active:true};tracks.set(key,t);}
  Object.assign(t,{active:true,color:d.color,label:d.label,duration:d.duration});
  const alpha=d.smoothing===0?1:1-Math.exp(-Math.min(100,Math.max(0,dt))/d.smoothing);
  t.point=t.point.map((v,i)=>v+alpha*(d.point[i]-v));
  const last=t.trail.at(-1);if(d.duration&&(!last||Math.hypot(...t.point.map((v,i)=>v-last.point[i]))>.02))t.trail.push({point:[...t.point],time:now});
 }
 for(const [key,t]of tracks){t.trail=t.trail.filter(p=>now-p.time<t.duration).slice(-120);if(!t.active&&!t.trail.length)tracks.delete(key);}
}
// Pure conversion keeps every legacy option for rollback and uses the existing
// orientation and display settings; only physical placement is supplied by user.
function floorConvertLegacy(config,id,legacy){
 if(legacy.type!=='custom:jarvis-target-card'||!legacy.entity_prefix)throw Error('Expected an existing Jarvis target card');
 const c=floorClone(config),s=c.placements.find(s=>s.id===id);if(!s)throw Error('Select a sensor first');
 c.hardware[id]={...c.hardware[id],entity_prefix:legacy.entity_prefix,targets:[],flip_x:!!legacy.flip_x,flip_y:!!legacy.flip_y,legacy_card:floorClone(legacy)};
 Object.assign(s,{smoothing_ms:legacy.smoothing_ms??180,trail_seconds:legacy.trail_seconds??8,show_fov:legacy.show_fov??true,fov_range:legacy.fov_range??6,fov_start:legacy.display_start_angle??-(legacy.fov_angle??120)/2,fov_end:legacy.display_end_angle??(legacy.fov_angle??120)/2,display_min_range:legacy.display_min_range??0});
 return floorValidate(c);
}
window.jarvisConvertTargetCard=floorConvertLegacy;
class JarvisFloorplanCard extends HTMLElement {
 constructor(){super();this.attachShadow({mode:'open'});this._tracks=new Map();this._desired=new Map();this._registry={entities:[]};}
 connectedCallback(){this._start();}
 disconnectedCallback(){cancelAnimationFrame(this._raf);this._raf=0;}
 _start(){if(this.isConnected&&!this._raf)this._raf=requestAnimationFrame(t=>this._animate(t));}
 static getStubConfig(){return floorDefaults();}
 static getConfigElement(){return document.createElement('jarvis-floorplan-card-editor');}
 setConfig(config){const next=floorValidate(config);if(JSON.stringify(next.floorplan_image)!==JSON.stringify(this._config?.floorplan_image))this._view=null;this._config=next;this._tracks.clear();this._render();this._start();}
 set hass(hass){this._hass=hass;this._refreshLive();if(this._registryConnection!==hass.connection||!this._registryLoaded){this._registryConnection=hass.connection;this._registryLoaded=true;floorRegistries(hass).then(r=>{if(this._hass?.connection!==hass.connection)return;this._registry=r;this._render();});}}
 getCardSize(){return 7;}
 getGridOptions(){return {columns:12,rows:7,min_columns:6,min_rows:4};}
 _node(parent,tag,attrs={},text){
  const n=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));
  if(text!==undefined)n.textContent=text;parent.append(n);return n;
 }
 _render(){
  if(!this._config)return;
  this.shadowRoot.innerHTML=`<style>
   :host{display:block}ha-card{display:block;padding:20px;overflow:hidden;border-radius:16px;border:1px solid var(--divider-color,#e1e6ec);background:var(--card-background-color,#fff);color:var(--primary-text-color,#172b40)}h2{font-size:20px;margin:0 0 8px}
   svg{display:block;width:100%;background:var(--secondary-background-color,#f4f6f8);color:var(--primary-text-color,#172b40);touch-action:pan-y;aspect-ratio:14.4/8.8;border-radius:12px}
   .status{font-size:12px;line-height:1.5;color:var(--secondary-text-color,#566779);margin:8px 0}.map-tools{display:flex;gap:6px;justify-content:flex-end;margin:8px 0}.map-tools button{border:1px solid var(--divider-color,#d6dfe8);border-radius:20px;background:var(--card-background-color,#fff);color:var(--primary-color,#03a9f4);min-height:36px;padding:0 14px;cursor:pointer}.map-tools button[aria-pressed=true]{background:var(--primary-color,#03a9f4);color:white} .sensor{cursor:pointer} .sensor text{font:0.18px sans-serif}
   .selection{display:none}.sensor[data-selected=true] .selection{display:block}.fov{opacity:.10;pointer-events:none} .target{stroke:white;stroke-width:.025}
   :host([editing]) svg{touch-action:none}:host([editing]) .sensor{cursor:grab}
   #sensor-dialog{position:fixed;inset:0 0 0 auto;margin:0;width:min(480px,95vw);height:100dvh;max-height:100dvh;box-sizing:border-box;overflow:auto;padding:24px;border:1px solid var(--divider-color,#dce3e9);border-radius:20px 0 0 20px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#172b40)}#sensor-dialog::backdrop{background:#10243466}#sensor-dialog button{min-height:40px;border:1px solid var(--divider-color,#dce3e9);border-radius:20px;padding:8px 16px;cursor:pointer}@media(max-width:600px){#sensor-dialog{inset:auto 0 0;margin:0;width:100%;height:auto;max-height:75dvh;border-radius:20px 20px 0 0}}
  </style><ha-card><h2></h2><div class="status"></div><div class="map-tools" role="toolbar" aria-label="Map navigation"><button data-view="out" aria-label="Zoom out">−</button><button data-view="in" aria-label="Zoom in">+</button><button data-view="fit">Fit</button><button data-view="pan" aria-pressed="false">Pan</button></div><svg role="img" aria-label="Ground-floor geometry in metres" viewBox="-1.4 -1.3 14.4 7.8" preserveAspectRatio="xMidYMid meet"></svg><p class="status">Klik op een sensor voor details · Bereik is schematisch</p><div id="live-status" class="status" role="status"></div></ha-card>`;
  this.shadowRoot.querySelector('h2').textContent=this._config.title||'Begane grond';
  this.shadowRoot.querySelector('.status').textContent=this._config.calibration.dimensions_confirmed?'Schaal en uitlijning visueel gecontroleerd.':'Controleer schaal en uitlijning · sensorposities blijven behouden.';
  const svg=this.shadowRoot.querySelector('svg');
  const image=this._config.floorplan_image;
  this.shadowRoot.querySelector('[data-view=pan]').setAttribute('aria-pressed',String(!!this._panning));if(this._panning)svg.style.touchAction='none';
  this._view=this._view||floorImageBounds(image);svg.setAttribute('viewBox',this._view.join(' '));
  for(const button of this.shadowRoot.querySelectorAll('[data-view]'))button.onclick=()=>{
   const action=button.dataset.view;
   if(action==='pan'){this._panning=!this._panning;button.setAttribute('aria-pressed',String(this._panning));svg.style.touchAction=this._panning?'none':'';return;}
   if(action==='fit')this._view=floorImageBounds(image);
   else {const [x,y,w,h]=this._view,k=action==='in'?.8:1.25;if(w*k<.2||w*k>4000)return;this._view=[x+w*(1-k)/2,y+h*(1-k)/2,w*k,h*k];}
   svg.setAttribute('viewBox',this._view.join(' '));
  };
  svg.onpointerdown=e=>{if(!this._panning||e.composedPath().some(n=>n.dataset?.sensor))return;const m=svg.getScreenCTM();if(!m)return;this._pan={id:e.pointerId,start:new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse()),matrix:m.inverse(),view:[...this._view]};svg.setPointerCapture(e.pointerId);e.preventDefault();};
  svg.onpointermove=e=>{if(this._pan?.id!==e.pointerId)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(this._pan.matrix),v=this._pan.view;this._view=[v[0]+this._pan.start.x-p.x,v[1]+this._pan.start.y-p.y,v[2],v[3]];svg.setAttribute('viewBox',this._view.join(' '));};
  svg.onpointerup=svg.onpointercancel=e=>{if(this._pan?.id===e.pointerId){this._pan=null;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);}};
  if(image){
   const n=this._node(svg,'image',{href:image.url,x:0,y:0,width:image.width,height:image.height,preserveAspectRatio:'none',transform:`translate(${image.x} ${image.y}) rotate(${image.rotation})`,'pointer-events':'none'});
   const status=this.shadowRoot.querySelector('.status');n.onerror=()=>{status.textContent='Floorplan image unavailable. Check the URL and access permissions. Sensor positions are preserved.';};
  }
  if(!image)for(let u=0;u<=12;u++)this._node(svg,'line',{x1:u,y1:0,x2:u,y2:5.2,stroke:'var(--divider-color,#dde5ec)','stroke-width':.012});
  if(!image)for(let v=0;v<=5;v++)this._node(svg,'line',{x1:0,y1:v,x2:11.674,y2:v,stroke:'var(--divider-color,#dde5ec)','stroke-width':.012});
  const sectors=this._node(svg,'g',{'data-layer':'sectors'});
  if(!image)for(const [a,b] of jarvisGroundFloor.segments){const [x1,y1]=floorToMap(a),[x2,y2]=floorToMap(b);this._node(svg,'line',{x1,y1,x2,y2,stroke:'var(--primary-text-color,#172b40)','stroke-width':.018,'pointer-events':'none'});}
  this._node(svg,'path',{d:'M0,5.55 H1 M0,5.48 V5.62 M1,5.48 V5.62',stroke:'var(--primary-text-color,#172b40)','stroke-width':.025});
  this._node(svg,'text',{x:0,y:5.9,'font-size':.18,fill:'var(--primary-text-color,#172b40)'},'1 m • model scale, no geographic north');
  for(const [i,s]of this._config.placements.entries()){
   const h=this._source(s),color=i===0?'#139b32':i===1?'#245aff':'#a548b0',center=floorToMap([s.x,s.y]),tip=floorToMap(floorProject(s,{},0,.5));
   if(s.show_fov!==false&&s.mounting==='wall'&&s.tilt===0){
    const points=[center];for(let j=0;j<=48;j++){const a=(s.fov_start+(s.fov_end-s.fov_start)*j/48)*Math.PI/180;points.push(floorToMap(floorProject(s,h,s.fov_range*Math.sin(a),s.fov_range*Math.cos(a))));}
    this._node(sectors,'polygon',{points:points.map(p=>p.join(',')).join(' '),fill:color,class:'fov'});
   }
   const g=this._node(svg,'g',{'data-sensor':s.id,class:'sensor','data-selected':String(this._selectedSensor===s.id),'aria-pressed':String(this._selectedSensor===s.id),tabindex:0,role:'button','aria-label':`${s.name}: ${s.x.toFixed(2)}, ${s.y.toFixed(2)} m; yaw ${s.yaw} degrees`});
   this._node(g,'circle',{cx:center[0],cy:center[1],r:.19,fill:'none',stroke:color,'stroke-width':.025,class:'selection','pointer-events':'none'});
   this._node(g,'line',{x1:center[0],y1:center[1],x2:tip[0],y2:tip[1],stroke:color,'stroke-width':.055,'pointer-events':'none'});
   this._node(g,'circle',{cx:center[0],cy:center[1],r:.11,fill:color,stroke:'transparent','stroke-width':24,'vector-effect':'non-scaling-stroke'});
   this._node(g,'text',{x:center[0]+.15,y:center[1]-.15,fill:color},s.name);
   if(this.hasAttribute('editing')){this._node(g,'circle',{cx:tip[0],cy:tip[1],r:.085,fill:'white',stroke:color,'stroke-width':.035,'pointer-events':'none'});this._node(g,'circle',{cx:tip[0],cy:tip[1],r:.085,fill:'white',stroke:'transparent','stroke-width':12,'vector-effect':'non-scaling-stroke','data-rotate':s.id});}
  }
  this._polygonLayer=this._node(svg,'g',{'data-layer':'polygons'});
  this._liveLayer=this._node(svg,'g',{'data-layer':'targets','pointer-events':'none'});this._refreshLive();
  for(const g of svg.querySelectorAll('[data-sensor]'))svg.append(g);
  for(const g of svg.querySelectorAll('[data-sensor]')){
   const open=()=>this.dispatchEvent(new CustomEvent('sensor-selected',{detail:{id:g.dataset.sensor},bubbles:true,composed:true}));
   g.onclick=()=>{if(!this.hasAttribute('editing'))this._openSensor(g.dataset.sensor);else open();};
   g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();g.onclick();}};
  }

 }
 _source(s){return floorResolve(this._hass,this._config.hardware[s.id]||{},this._registry);}
 _reason(s,h=this._source(s)){
  if(s.mounting!=='wall'||s.tilt!==0)return 'Ceiling/tilted projection is not yet supported; placement is saved, targets are not projected.';
  if(h.mode_entity&&this._hass?.states?.[h.mode_entity]?.state!=='side')return 'Device mounting mode is not Side. Check hardware settings in ESPHome.';
  if(!h.targets.length)return h.warnings.join(' ');
  return null;
 }
 _refreshLive(){
  if(!this._liveLayer||!this._config)return;
  this._desired=new Map();this._polygonLayer?.replaceChildren();const status=[];
  for(const [i,s]of this._config.placements.entries()){
   const h=this._source(s),reason=this._reason(s,h),color=['#139b32','#245aff','#a548b0'][i%3];
   if(reason){status.push(`${s.name}: ${reason}`);if(s.mounting!=='wall'||s.tilt!==0||(h.mode_entity&&this._hass?.states?.[h.mode_entity]?.state!=='side'))continue;}
   let count=0,invalid=0;
   for(const [j,t]of h.targets.entries()){
    const x=floorMetres(this._hass?.states?.[t.x_entity]),y=floorMetres(this._hass?.states?.[t.y_entity]);
    if(x===null||y===null){invalid++;continue;}
    if((x===0&&y===0)||Math.hypot(x,y)>6)continue;
    this._desired.set(`${s.id}:${t.x_entity}:${t.y_entity}`,{point:floorToMap(floorProject(s,h,x,y)),color,label:`${s.name} T${t.id??j+1}`,smoothing:s.smoothing_ms??180,duration:(s.trail_seconds??8)*1000});count++;
   }
   if(s.show_fov!==false){
    const read=(id,angle=false)=>{const state=this._hass?.states?.[id];return angle?(state?.attributes?.unit_of_measurement==='°'&&String(state.state).trim()?Number(state.state):NaN):floorMetres(state);};
    const r=read(h.distance),start=read(h.start_angle,true),end=read(h.end_angle,true);
    if(r>0&&r<=6&&Number.isFinite(start)&&Number.isFinite(end)&&start>=-60&&end<=60&&start<end){
     const points=[floorToMap([s.x,s.y])];for(let j=0;j<=48;j++){const a=(start+(end-start)*j/48)*Math.PI/180;points.push(floorToMap(floorProject(s,h,r*Math.sin(a),r*Math.cos(a))));}
     this._node(this._polygonLayer,'polygon',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:'#64748b','stroke-width':.025,'stroke-dasharray':'.08 .05'});
    }
   }
   for(const [key,id]of Object.entries(h.polygons)){
    const points=JarvisTargetCard.prototype._parse(this._hass?.states?.[id]?.state);
    if(points?.length)this._node(this._polygonLayer,'polygon',{points:points.map(p=>floorToMap(floorProject(s,h,...p)).join(',')).join(' '),fill:key.startsWith('zone')?color:'#ef4444','fill-opacity':.07,stroke:key.startsWith('zone')?color:'#ef4444','stroke-width':.025,'stroke-dasharray':key.startsWith('zone')?'':'.08 .05','data-zone-sensor':s.id,'data-zone-key':key,'pointer-events':this._arranging?'visiblePainted':'none'});
   }
   const occupancy=h.occupancy?this._hass?.states?.[h.occupancy]?.state:null;
   status.push(`${s.name}: ${count} targets${occupancy?` · presence ${occupancy}`:''}${!s.calibrated?' · placement not verified':''}${invalid?' · X/Y unavailable or units missing':''}${h.warnings.length?' · '+h.warnings.join(' '):''}`);
  }
  this.shadowRoot.querySelector('#live-status').textContent=status.join(' | ');
  for(const local of this.shadowRoot.querySelectorAll('jarvis-target-card'))local.hass=this._hass;
  this._drawFrame(performance.now(),0);this._start();
 }
 _drawFrame(now,dt){
  floorStep(this._tracks,this._desired,now,dt);if(!this._liveLayer)return;
  this._liveLayer.replaceChildren();
  for(const t of this._tracks.values()){
   // Group samples into eight opacity bands: bounded SVG nodes even for many sensors.
   for(let band=0;band<8;band++){
    let d='';for(let i=1;i<t.trail.length;i++){const p=t.trail[i],a=t.trail[i-1],b=Math.min(7,Math.floor(8*(now-p.time)/t.duration));if(b===band)d+=`M${a.point.join(',')}L${p.point.join(',')}`;}
    if(d)this._node(this._liveLayer,'path',{d,fill:'none',stroke:t.color,'stroke-width':.035,opacity:(1-band/8)*.65});
   }
   if(t.active){const[cx,cy]=t.point;this._node(this._liveLayer,'circle',{cx,cy,r:.085,fill:t.color,class:'target'});this._node(this._liveLayer,'text',{x:cx+.12,y:cy,'font-size':.16,fill:'var(--primary-text-color,#172b40)'},t.label);}
  }
 }
 _animate(now){this._raf=0;if(!this.isConnected)return;this._drawFrame(now,Math.min(100,now-(this._lastFrame??now)));this._lastFrame=now;this._start();}
 _openSensor(id){
  this.shadowRoot.querySelector('#sensor-dialog')?.remove();
  const dialog=document.createElement('dialog');dialog.id='sensor-dialog';dialog.setAttribute('aria-label','Sensor details');
  const close=document.createElement('button');close.textContent='Close';close.onclick=()=>dialog.close();
  const note=document.createElement('p');note.textContent='Sensor settings. To change placement or source, use Edit dashboard → Edit card → select this sensor, then Save.';
  const s=this._config.placements.find(p=>p.id===id),h=this._source(s),info=document.createElement('p');info.textContent=`${s.name} · ${s.mounting} · ${h.targets.length} X/Y pairs · rotation ${s.yaw}°`;
  dialog.append(close,note,info);this._appendPolygonEditor(dialog,s,h);this.shadowRoot.append(dialog);dialog.showModal();
 }
 _appendPolygonEditor(root,s,h){
  const note=document.createElement('p');note.textContent='Zones bewerken op de grote plattegrond: kies Inrichten in de livekaart. Hier staan alleen sensorinstellingen.';root.append(note);
 }


}

// Inverse of floorProject, including display scale and both mirrored axes.
function floorUnproject(s,h,x,y){
 const a=s.yaw*Math.PI/180,dx=x-s.x,dy=y-s.y,k=s.scale??1;
 return [(dx*Math.sin(a)-dy*Math.cos(a))/k*(h.flip_x?-1:1),(dx*Math.cos(a)+dy*Math.sin(a))/k*(h.flip_y?-1:1)];
}
function floorZoneValue(points){
 if(points.length!==0&&(points.length<3||points.length>20))throw Error('Gebruik 3–20 hoekpunten, of wis de hele zone.');
 for(const [x,y]of points)if(!Number.isFinite(x)||!Number.isFinite(y)||y<0||Math.hypot(x,y)>6.001||Math.abs(Math.atan2(x,y)*180/Math.PI)>60.01)throw Error('Zone ligt buiten de LD2460-sector (6 m, −60° tot 60°).');
 return JarvisTargetCard.prototype._serialize(points);
}
const floorBaseRender=JarvisFloorplanCard.prototype._render;
const floorBaseSetConfig=JarvisFloorplanCard.prototype.setConfig;
JarvisFloorplanCard.prototype.setConfig=function(config){
 // External configuration always wins; never silently rebase an active draft.
 this._arranging=false;this._zoneDraft=null;this._baseline=null;floorBaseSetConfig.call(this,config);
};
JarvisFloorplanCard.prototype._openSensor=function(id){this._selectedSensor=id;this._render();};
JarvisFloorplanCard.prototype._message=function(text){this._notice=text;const n=this.shadowRoot.querySelector('#arrange-message');if(n)n.textContent=text;};
JarvisFloorplanCard.prototype._zoneContext=function(){
 const s=this._config.placements.find(s=>s.id===this._selectedSensor);if(!s)return null;
 const h=this._source(s),id=h.polygons[this._zoneKey||'zone:1'];return {s,h,id};
};
JarvisFloorplanCard.prototype._loadZone=function(){
 const c=this._zoneContext();this._drawingZone=false;this._zoneDraft=c?.id?(JarvisTargetCard.prototype._parse(this._hass?.states?.[c.id]?.state)||[]):[];
 this._zoneOriginal=c?.id?this._hass?.states?.[c.id]?.state:null;this._zoneEntity=c?.id;this._vertex=null;
};
JarvisFloorplanCard.prototype._applyZone=async function(rollback=false){
 const c=this._zoneContext();if(!this._arranging||!c?.id||c.id!==this._zoneEntity||this._drawingZone||this._applying)return;
 if(c.s.mounting!=='wall'||c.s.tilt!==0||(c.h.mode_entity&&this._hass.states[c.h.mode_entity]?.state!=='side'))return this._message('Alleen wandmontage / Side zonder tilt wordt ondersteund.');
 try{
  const value=rollback?this._rollback?.value:floorZoneValue(this._zoneDraft||[]);
  if(value===undefined||rollback&&this._rollback.id!==c.id)throw Error('Geen herstelwaarde voor deze entiteit.');
  const before=this._hass.states[c.id]?.state;
  if(before==null||['unknown','unavailable'].includes(before))throw Error('Polygon-entiteit is niet beschikbaar.');
  if(value.length>(this._hass.states[c.id]?.attributes?.max??255))throw Error('Polygon is te lang voor deze text-entiteit. Verminder het aantal punten.');
  if(!rollback&&before!==this._zoneOriginal)throw Error('ESPHome-zone is intussen veranderd. Herlaad voor toepassen.');
  if(!window.confirm(`${rollback?'Herstel':'Apply to ESPHome'}: ${c.s.name}, ${this._zoneKey||'zone:1'}\n${c.id}\n${value||'(lege zone)'}\nESPHome rapporteert optimistisch. Doorgaan?`))return;
  this._applying=true;this._render();
  await this._hass.callService('text','set_value',{entity_id:c.id,value});
  this._rollback={id:c.id,value:before};this._zoneOriginal=value;
  this._message(`Verzonden naar ${c.id}; controleer de entiteit en fysieke detectie. Geen hardwarebevestiging.`);
 }catch(e){this._message(e.message||String(e));}finally{this._applying=false;this._render();}
};
JarvisFloorplanCard.prototype._render=function(){
 floorBaseRender.call(this);if(!this._config||this.hasAttribute('editing'))return;
 const root=this.shadowRoot,card=root.querySelector('ha-card'),svg=root.querySelector('svg'),bar=root.querySelector('.map-tools');
 bar.style.cssText='display:flex;flex-wrap:nowrap;overflow-x:auto;justify-content:flex-start;padding-bottom:4px';
 const style=document.createElement('style');style.textContent='.map-tools button{flex-shrink:0}.map-tools select{min-height:44px;max-width:100%;padding:6px;border-radius:8px}.map-tools button{min-height:44px}svg{min-height:360px}@media(max-width:600px){ha-card{padding:10px}svg{min-height:420px}}';root.append(style);
 const button=(parent,label,fn)=>{const b=document.createElement('button');b.textContent=label;b.onclick=fn;b.disabled=!!this._applying;parent.append(b);return b;};
 button(bar,this._arranging?'Inrichten actief':'Inrichten',()=>{if(this._arranging)return;this._notice='Lokale preview: exporteer plaatsingen om ze via de kaarteditor te bewaren. Zones pas na bevestiging naar ESPHome.';this._baseline=floorClone(this._config);this._arranging=true;this._selectedSensor=this._selectedSensor||this._config.placements[0]?.id;this._loadZone();this._render();});
 const panel=document.createElement('div');panel.className='map-tools';panel.style.cssText='justify-content:flex-start;flex-wrap:wrap;align-items:center';card.insertBefore(panel,svg);
 const msg=document.createElement('p');msg.id='arrange-message';msg.className='status';msg.setAttribute('role','status');msg.textContent=this._notice||'Inrichten: lokale preview. Bewaren via configuratie-export en de officiële kaarteditor. ESPHome apart toepassen.';card.insertBefore(msg,svg);
 if(!this._arranging){if(this._selectedSensor){const c=this._zoneContext();msg.textContent=`${c.s.name} · ${c.s.mounting} · ${c.s.yaw.toFixed(1)}° · Kies Inrichten om te verplaatsen of zones te tekenen.`;}return;}
 svg.style.touchAction='none';
 button(bar,'Annuleren',()=>{this._config=this._baseline;this._arranging=false;this._zoneDraft=null;this._notice='Preview verworpen. Reeds toegepaste ESPHome-wijzigingen blijven bestaan; herstel ze afzonderlijk.';this._render();});
 button(bar,'Bewaren / export',()=>{
  const d=document.createElement('dialog'),text=document.createElement('textarea');text.value=JSON.stringify(this._config,null,2);text.style.cssText='width:100%;height:40vh';text.readOnly=true;
  const note=document.createElement('p');note.textContent='Nog niet opgeslagen in Home Assistant. Kopieer deze volledige configuratie naar Dashboard bewerken → Kaart bewerken → Code-editor en druk daar Opslaan. JSON is geldige YAML. Zonepreviews horen niet bij deze export; gebruik daarvoor Apply to ESPHome.';
  d.style.cssText='width:min(650px,85vw);max-height:85vh;overflow:auto';d.append(note,text);button(d,'Selecteer configuratie',()=>{text.focus();text.select();});button(d,'Download configuratie',()=>{const url=URL.createObjectURL(new Blob([text.value],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='jarvis-floorplan-config.json';a.click();URL.revokeObjectURL(url);});button(d,'Sluiten',()=>d.remove());root.append(d);d.showModal();
 });
 const select=document.createElement('select');select.setAttribute('aria-label','Sensor');for(const s of this._config.placements){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;select.append(o);}select.value=this._selectedSensor;select.onchange=()=>{if(!window.confirm('Andere sensor selecteren? Zonepreview wordt verworpen.'))return;this._selectedSensor=select.value;this._loadZone();this._render();};panel.append(select);
 button(panel,'Sensor plaatsen',()=>{this._zoneInteraction=false;this._drawingZone=false;this._render();});button(panel,'Zone bewerken',()=>{this._zoneInteraction=true;this._render();});
 const c=this._zoneContext();if(!c)return;
 const zones=document.createElement('select');zones.setAttribute('aria-label','Zone');for(const kind of ['zone','exclusion'])for(let i=1;i<=(kind==='zone'?4:2);i++){const o=document.createElement('option');o.value=`${kind}:${i}`;o.textContent=`${kind==='zone'?'Detectie':'Uitsluiting'} ${i}${c.h.polygons[o.value]?'':' (niet gekoppeld)'}`;zones.append(o);}zones.value=this._zoneKey||'zone:1';zones.onchange=()=>{if(!window.confirm('Zonepreview verwerpen en andere zone selecteren?'))return;this._zoneKey=zones.value;this._loadZone();this._render();};panel.append(zones);
 const supported=c.s.mounting==='wall'&&c.s.tilt===0&&(!c.h.mode_entity||this._hass?.states?.[c.h.mode_entity]?.state==='side');
 for(const [label,fn]of [
 ['Tekenen',()=>{this._zoneInteraction=true;this._zoneDraft=[];this._drawingZone=true;this._render();}],
 ['Gereed',()=>{try{floorZoneValue(this._zoneDraft||[]);this._drawingZone=false;this._render();}catch(e){this._message(e.message);}}],
 ['Punt verwijderen',()=>{if(this._vertex!=null){this._zoneDraft.splice(this._vertex,1);this._vertex=null;this._render();}}],
 ['Zone wissen',()=>{this._zoneDraft=[];this._drawingZone=false;this._render();}],
 ['Herlaad zone',()=>{if(window.confirm('Lokale zonepreview verwerpen?')){this._loadZone();this._render();}}],
 ['Apply to ESPHome',()=>this._applyZone()],['Herstel vorige',()=>this._applyZone(true)]
 ])button(panel,label,fn).disabled=this._applying||!c.id||!supported;
 const hint=document.createElement('span');hint.textContent=`${c.id||'Geen eenduidige polygon-entiteit'} · ${this._drawingZone?'Tik hoekpunten op de plattegrond':'Sleep sensor, draairing of hoekpunt'} · zonepreview niet opgeslagen`;hint.style.cssText='font-size:12px;line-height:1.4;flex-basis:100%';panel.append(hint);
 const draw=()=>{
  svg.querySelector('[data-zone-preview]')?.remove();const g=this._node(svg,'g',{'data-zone-preview':'true'});
  if(!supported)return;
  const points=(this._zoneDraft||[]).map(p=>floorToMap(floorProject(c.s,c.h,...p)));
  this._node(g,!this._drawingZone&&points.length>=3?'polygon':'polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'#0ea5e9','fill-opacity':.15,stroke:'#0284c7','stroke-width':3,'vector-effect':'non-scaling-stroke','pointer-events':'none'});
  if(this._zoneInteraction)points.forEach(([cx,cy],i)=>this._node(g,'circle',{cx,cy,r:.045,fill:i===this._vertex?'#f59e0b':'white',stroke:'#0284c7','stroke-width':12,'vector-effect':'non-scaling-stroke','data-zone-vertex':i}));
 };draw();
 // Handle remains on the main canvas; properties never open a modal sidebar.
 const tip=floorToMap(floorProject(c.s,{},0,.5));this._node(svg,'circle',{cx:tip[0],cy:tip[1],r:.06,fill:'white',stroke:'#0284c7','stroke-width':14,'vector-effect':'non-scaling-stroke','data-live-rotate':c.s.id,'pointer-events':this._zoneInteraction?'none':'all'});
 const world=e=>{const m=svg.getScreenCTM();if(!m)return null;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());return floorFromMap([p.x,p.y]);};
 const baseDown=svg.onpointerdown,baseMove=svg.onpointermove,baseUp=svg.onpointerup;
 svg.onpointerdown=e=>{
  if(e.button!==0||this._applying)return;if(this._panning){baseDown(e);return;}
  const p=world(e);if(!p)return;const path=e.composedPath();
  // SVG touch dispatch may target the SVG rather than a small circle. Resolve
  // nearest handles in screen pixels so zoom never shrinks the touch target.
  const nearest=selector=>{let best=null,distance=23;for(const n of svg.querySelectorAll(selector)){const q=new DOMPoint(+n.getAttribute('cx'),+n.getAttribute('cy')).matrixTransform(svg.getScreenCTM()),d=Math.hypot(q.x-e.clientX,q.y-e.clientY);if(d<distance){best=n;distance=d;}}return best;};
  const hit=!this._zoneInteraction&&(path.find(n=>n.dataset?.liveRotate)||path.find(n=>n.dataset?.sensor)||nearest('[data-live-rotate],[data-sensor] circle:not(.selection)'));
  const v=this._zoneInteraction?(nearest('[data-zone-vertex]')||path.find(n=>n.dataset?.zoneVertex!==undefined)):null,rotate=hit?.dataset?.liveRotate?hit:null,sensor=hit?(hit.dataset?.sensor?hit:hit.closest?.('[data-sensor]')):null;
  if(v){this._vertex=+v.dataset.zoneVertex;this._gesture={vertex:this._vertex};}
  else if(path.some(n=>n.dataset?.zoneKey)&&!this._drawingZone){const z=path.find(n=>n.dataset?.zoneKey);if(!window.confirm('Zonepreview verwerpen en deze zone selecteren?'))return;this._selectedSensor=z.dataset.zoneSensor;this._zoneKey=z.dataset.zoneKey;this._loadZone();this._render();return;}
  else if((rotate||sensor)&&!this._zoneInteraction){const id=rotate?.dataset.liveRotate||sensor.dataset.sensor;if(id!==this._selectedSensor){if((this._zoneDraft?.length||0)&&!window.confirm('Zonepreview verwerpen en sensor selecteren?'))return;this._selectedSensor=id;this._loadZone();this._render();return;}this._gesture={rotate:!!rotate,dx:c.s.x-p[0],dy:c.s.y-p[1]};}
  else if(this._drawingZone&&supported&&c.id){if(this._zoneDraft.length>=20)return this._message('Maximaal 20 hoekpunten.');this._zoneDraft.push(floorUnproject(c.s,c.h,...p));draw();return;}
  else return;
  this._gesture.beforePose=floorClone(c.s);this._gesture.beforeZone=floorClone(this._zoneDraft);this._gesture.pointer=e.pointerId;svg.setPointerCapture(e.pointerId);e.preventDefault();
 };
 svg.onpointermove=e=>{if(this._pan){baseMove(e);return;}const g=this._gesture;if(!g||g.pointer!==e.pointerId)return;const p=world(e);if(!p)return;
  if(g.vertex!==undefined){this._zoneDraft[g.vertex]=floorUnproject(c.s,c.h,...p);draw();}
  else{if(g.rotate)c.s.yaw=Math.atan2(p[1]-c.s.y,p[0]-c.s.x)*180/Math.PI;else{c.s.x=p[0]+g.dx;c.s.y=p[1]+g.dy;}c.s.calibrated=false;
   // Keep pointer capture on this SVG until release. Update all projected layers on release.
   const group=svg.querySelector(`[data-sensor="${c.s.id}"]`);const before=g.beforePose,origin=floorToMap([before.x,before.y]),now=floorToMap([c.s.x,c.s.y]);group.setAttribute('transform',`translate(${now[0]-origin[0]} ${now[1]-origin[1]}) rotate(${-(c.s.yaw-before.yaw)} ${origin[0]} ${origin[1]})`);this._message(`${c.s.name}: ${c.s.x.toFixed(2)}, ${c.s.y.toFixed(2)} m · ${c.s.yaw.toFixed(1)}° (preview)`);
   const marker=svg.querySelector('[data-live-rotate]'),q=floorToMap(g.rotate?floorProject(c.s,{},0,.5):[c.s.x,c.s.y]);marker.setAttribute('cx',q[0]);marker.setAttribute('cy',q[1]);draw();}
  e.preventDefault();};
 svg.onpointerup=e=>{if(this._gesture?.pointer===e.pointerId){this._gesture=null;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);this._render();}else baseUp(e);};
 svg.onpointercancel=e=>{if(this._gesture){Object.assign(c.s,this._gesture.beforePose);this._zoneDraft=this._gesture.beforeZone;}this._gesture=null;baseUp(e);this._render();};
};

class JarvisFloorplanCardEditor extends HTMLElement {
 constructor(){super();this.attachShadow({mode:'open'});this._selected='kantoor';}
 set hass(hass){this._hass=hass;if(this._preview)this._preview.hass=hass;for(const local of this.shadowRoot.querySelectorAll('jarvis-target-card'))local.hass=hass;
  if(this._connection!==hass.connection||!this._registry){this._connection=hass.connection;floorRegistries(hass).then(r=>{if(this._hass?.connection!==hass.connection)return;this._registry=r;if(this._preview){this._preview._registry=r;this._preview._render();}this._sourceOptions();const tools=this.shadowRoot.querySelector('#polygon-tools');if(tools&&!tools.querySelector('details[open]')){tools.replaceChildren();const s=this._selectedPose();if(s)this._preview._appendPolygonEditor(tools,s,this._preview._source(s));}});}
 }
 setConfig(config){
  // Home Assistant echoes emitted configs; retain focus and pointer capture.
  if(this._lastEmitted===JSON.stringify(config))return;
  this._config=floorValidate(config);this._selected=this._config.placements.some(s=>s.id===this._selected)?this._selected:this._config.placements[0]?.id;this._build();
 }
 _emit(next){
  const c=floorValidate(next);this._config=c;this._lastEmitted=JSON.stringify(c);
  this._preview.setConfig(c);if(this._hass)this._preview.hass=this._hass;
  this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:floorClone(c)},bubbles:true,composed:true}));
 }
 _selectedPose(){return this._config.placements.find(s=>s.id===this._selected);}
 _build(){
  this.shadowRoot.innerHTML=`<style>
   :host{display:block;color:var(--primary-text-color,#182b3c);font:14px var(--paper-font-body1_-_font-family,system-ui);container-type:inline-size}
   *{box-sizing:border-box}button,input,select,textarea{font:inherit;max-width:100%}button{min-height:40px;border:1px solid var(--divider-color,#dce3e9);border-radius:22px;padding:8px 16px;background:var(--card-background-color,#fff);color:var(--primary-color,#007eaf);cursor:pointer}button:hover{filter:brightness(.96)}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}.primary{background:var(--primary-color,#007eaf);color:var(--text-primary-color,#fff);border-color:transparent}.danger{color:var(--error-color,#b42318)}
   .toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 0}.toolbar strong{margin-right:auto;font-size:18px}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:16px;align-items:start}.canvas{min-width:0}jarvis-floorplan-card{display:block}aside{min-width:0;border:1px solid var(--divider-color,#dce3e9);border-radius:16px;padding:16px;background:var(--card-background-color,#fff);max-height:78vh;overflow:auto}aside header{position:sticky;top:-16px;padding:8px 0;background:var(--card-background-color,#fff);z-index:1;display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}aside h3{margin:0;font-size:16px}label{display:flex;flex-direction:column;gap:6px;margin:12px 0;min-width:0}input,select,textarea{width:100%;padding:10px;border:1px solid var(--divider-color,#c8d4df);border-radius:8px;color:var(--primary-text-color,#182b3c);background:var(--card-background-color,#fff);min-height:42px}input[type=checkbox]{width:20px;min-height:20px;align-self:flex-start;accent-color:var(--primary-color,#03a9f4)}details{border-top:1px solid var(--divider-color,#e3e9ee);padding:14px 0}summary{cursor:pointer;font-weight:600;line-height:1.6}p{line-height:1.6;color:var(--secondary-text-color,#566779);font-size:13px}.save-note{border-radius:8px;padding:10px 14px;background:var(--secondary-background-color,#eef5f9);margin-top:0}#error,#image-error{color:var(--error-color,#b42318)}#error:empty,#image-error:empty{display:none}#discovery{padding:10px;background:var(--secondary-background-color,#eef5f9);border-radius:8px;overflow-wrap:anywhere}#close-panel{display:none}#image-dialog{width:min(560px,94vw);max-height:90vh;overflow:auto;border:1px solid var(--divider-color,#dce3e9);border-radius:20px;padding:24px;background:var(--card-background-color,#fff);color:inherit}dialog::backdrop{background:#10243466}.image-fields{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}textarea{min-height:140px}
   @container (max-width:800px){.workspace{grid-template-columns:1fr}aside{display:none}aside[data-open]{display:block;position:fixed;inset:auto 0 0;max-height:70dvh;z-index:10;border-radius:20px 20px 0 0;box-shadow:0 -12px 60px #10243444;padding:20px}#close-panel{display:block}.toolbar strong{width:100%}.toolbar button{flex:1;padding:8px}.toolbar #image{flex-basis:100%}.save-note{font-size:12px}}
  </style>
   <div class="toolbar" role="toolbar" aria-label="Floorplan actions"><strong>Plattegrond</strong><button id="image" class="primary">Plattegrond uploaden/vervangen</button><button id="add">+ Sensor</button><button id="settings">Sensorinstellingen</button><button id="scale-check">Schaal controleren</button></div>
   <p class="save-note" role="status">Concept · Sleep een sensor om te verplaatsen. Sla daarna de kaart op in Home Assistant.</p>
   <div class="workspace"><div class="canvas"><jarvis-floorplan-card editing></jarvis-floorplan-card></div><aside aria-label="Sensor settings"><header><h3>Sensorinstellingen</h3><button id="close-panel" aria-label="Close sensor settings">Sluiten</button></header><label>Sensor<select id="sensor"></select></label><div id="fields"></div><button id="remove" class="danger">Sensor verwijderen</button>
   <details><summary>Import old radar card</summary><p>Paste existing flat YAML or JSON settings to migrate this sensor.</p><textarea id="legacy" aria-label="Old radar card configuration"></textarea><button id="import">Import into selected sensor</button></details></aside></div>
   <p id="error" role="alert"></p>`;
  this.shadowRoot.querySelector('#image').onclick=()=>this._imageDialog();
  this.shadowRoot.querySelector('#scale-check').onclick=()=>{
   this.shadowRoot.querySelector('#image-dialog')?.remove();
   const dialog=document.createElement('dialog');dialog.id='image-dialog';dialog.setAttribute('aria-label','Schaal en uitlijning controleren');dialog.innerHTML='<h2>Schaal en uitlijning</h2><p>Controleer twee onafhankelijke afstanden en drie bekende punten op de kaart. Vergelijk daarna de sensorposities met de echte ruimte. Dit is een visuele bevestiging, geen automatische meting.</p><div class="actions"><button class="primary">Gecontroleerd</button><button>Annuleren</button></div>';
   const buttons=dialog.querySelectorAll('button');buttons[0].onclick=()=>{this._emit({...this._config,calibration:{...this._config.calibration,dimensions_confirmed:true}});dialog.close();};buttons[1].onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();this.shadowRoot.append(dialog);dialog.showModal();
  };
  const panel=this.shadowRoot.querySelector('aside');
  this.shadowRoot.querySelector('#settings').onclick=()=>panel.setAttribute('data-open','');
  this.shadowRoot.querySelector('#close-panel').onclick=()=>{panel.removeAttribute('data-open');this.shadowRoot.querySelector('#settings').focus();};
  panel.onkeydown=e=>{if(e.key==='Escape'){panel.removeAttribute('data-open');this.shadowRoot.querySelector('#settings').focus();}};
  this._preview=this.shadowRoot.querySelector('jarvis-floorplan-card');this._preview.setConfig(this._config);if(this._hass)this._preview.hass=this._hass;
  const select=this.shadowRoot.querySelector('#sensor');
  for(const s of this._config.placements){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;select.append(o);}select.value=this._selected||'';
  select.onchange=()=>{this._selected=select.value;this._fields();};this._fields();
  this.shadowRoot.querySelector('#add').onclick=()=>this._try(()=>{
   let n=1;while(this._config.placements.some(s=>s.id===`sensor-${n}`))n++;
   const id=`sensor-${n}`;this._selected=id;
   this._emit({...this._config,placements:[...this._config.placements,{...floorDefaults().placements[0],id,name:`Roomnode ${n}`,x:6,y:6,yaw:0}]});this._build();
  });
  this.shadowRoot.querySelector('#remove').onclick=()=>this._try(()=>{const hardware={...this._config.hardware};delete hardware[this._selected];this._emit({...this._config,hardware,placements:this._config.placements.filter(s=>s.id!==this._selected)});this._selected=this._config.placements[0]?.id;this._build();});
  this.shadowRoot.querySelector('#import').onclick=()=>this._try(()=>{
   const text=this.shadowRoot.querySelector('#legacy').value.trim();let legacy;
   if(text.startsWith('{'))legacy=JSON.parse(text);
   else {legacy={};for(const line of text.split('\n')){
    if(!line.trim()||line.trim().startsWith('#'))continue;
    const m=line.match(/^([a-z_]+):\s*(.*?)\s*$/);if(!m)throw Error('Use the original flat card YAML; nested options can be imported as JSON.');
    const raw=m[2];legacy[m[1]]=raw==='true'?true:raw==='false'?false:raw!==''&&Number.isFinite(Number(raw))?Number(raw):raw.replace(/^['"]|['"]$/g,'');
   }}
   this._emit(floorConvertLegacy(this._config,this._selected,legacy));this._fields();
  });
  this._preview.addEventListener('sensor-selected',e=>{this._selected=e.detail.id;select.value=this._selected;this._fields();panel.setAttribute('data-open','');select.focus({preventScroll:true});});
  // Capture on the preview host, which survives redraws. Pointer positions use inverse SVG CTM.
  this._preview.addEventListener('pointerdown',e=>this._down(e));
  this._preview.addEventListener('pointermove',e=>this._move(e));
  this._preview.addEventListener('pointerup',e=>this._end(e));
  this._preview.addEventListener('pointercancel',e=>this._end(e));
  this._preview.addEventListener('lostpointercapture',()=>{this._drag=null;});
 }
 _imageDialog(){
  this.shadowRoot.querySelector('#image-dialog')?.remove();
  const dialog=document.createElement('dialog');dialog.id='image-dialog';dialog.setAttribute('aria-labelledby','image-title');
  dialog.innerHTML=`<h2 id="image-title">Plattegrond uploaden/vervangen</h2><p>Deze kaart slaat zelf geen bestanden op. Plaats je SVG, PNG of JPG met je bestaande bestandsbeheer in <b>config/www</b> en vul hieronder <b>/local/bestandsnaam.png</b> in. Een vaste HTTPS-afbeeldingslink kan ook.</p><p>Let op: /local-bestanden zijn zonder HA-login toegankelijk. Gebruik geen vertrouwelijke bouwtekening. Tijdelijke media-, blob- en downloadlinks worden niet ondersteund.</p><label>Afbeeldings-URL<input id="image-url" type="text" placeholder="/local/plattegrond.png"></label><div class="image-fields"></div><p>Breedte en hoogte zijn de echte afmetingen van de volledige afbeelding, inclusief marges. X/Y zijn kaartmeters (rechts/omlaag), niet sensorassen. Controleer minstens twee afstanden en drie bekende punten.</p><p role="status">Vervangen of uitlijnen wist de schaalcontrole. Sensorposities, koppelingen en polygonen blijven behouden. Controleer de uitlijning vóór gebruik.</p><p id="image-error" role="alert"></p><div class="actions"><button id="image-apply" class="primary">Controleren en gebruiken</button><button id="image-cancel">Annuleren</button><button id="image-reset">Originele plattegrond</button></div>`;
  const image=this._config.floorplan_image||{url:'',width:11.674,height:5.2,x:0,y:0,rotation:0};
  dialog.querySelector('#image-url').value=image.url;
  for(const [key,label,step]of [['width','Breedte (m)',.01],['height','Hoogte (m)',.01],['x','Oorsprong X (m)',.01],['y','Oorsprong Y (m)',.01],['rotation','Rotatie (°)',1]]){
   const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='number';input.step=step;input.value=image[key];input.dataset.image=key;l.append(input);dialog.querySelector('.image-fields').append(l);
  }
  const error=dialog.querySelector('#image-error'),apply=dialog.querySelector('#image-apply');
  dialog.querySelector('#image-cancel').onclick=()=>dialog.close();
  dialog.querySelector('#image-reset').onclick=()=>{this._emit(floorReplaceImage(this._config,null));dialog.close();};
  apply.onclick=async()=>{
   apply.disabled=true;error.textContent='Afbeelding controleren…';
   try{
    const next={url:dialog.querySelector('#image-url').value.trim()};
    for(const input of dialog.querySelectorAll('[data-image]')){if(!input.value.trim())throw Error('Vul alle afmetingen en de oorsprong in.');next[input.dataset.image]=Number(input.value);}
    floorImageValidate(next);
    await new Promise((resolve,reject)=>{const img=new Image(),timer=setTimeout(()=>reject(Error('Afbeelding laden duurt te lang. Controleer de URL.')),10000);img.onload=()=>{clearTimeout(timer);if(img.naturalWidth*img.naturalHeight>40000000)reject(Error('Afbeelding te groot (maximaal 40 megapixels).'));else resolve();};img.onerror=()=>{clearTimeout(timer);reject(Error('Afbeelding niet bereikbaar of geen ondersteund beeldbestand.'));};img.src=next.url;});
    if(!dialog.open)return;
    this._emit(floorReplaceImage(this._config,next));dialog.close();
   }catch(e){error.textContent=e.message;}finally{apply.disabled=false;}
  };
  this.shadowRoot.append(dialog);dialog.showModal();
 }
 _try(fn){try{fn();this.shadowRoot.querySelector('#error').textContent='';}catch(e){this.shadowRoot.querySelector('#error').textContent=e.message;}}
 _fields(){
  this._preview._selectedSensor=this._selected;for(const node of this._preview.shadowRoot.querySelectorAll('[data-sensor]')){node.dataset.selected=String(node.dataset.sensor===this._selected);node.setAttribute('aria-pressed',node.dataset.selected);}
  const root=this.shadowRoot.querySelector('#fields');root.replaceChildren();const s=this._selectedPose();if(!s)return;
  const advanced=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Positie en montage';advanced.open=true;advanced.append(summary);root.append(advanced);
  const group=title=>{const d=document.createElement('details'),t=document.createElement('summary');t.textContent=title;d.append(t);root.append(d);return d;};
  const coverage=group('Bereik en assen'),motion=group('Beweging en sporen');
  for(const [key,label,min,max,step]of [['scale','Afstandsschaal sensor',.1,10,.01],['smoothing_ms','Vloeiende beweging (ms)',0,2000,10],['trail_seconds','Sporen (seconden)',0,60,1],['x','Positie X (m)',-1000,1000,.01],['y','Positie Y (m)',-1000,1000,.01],['yaw','Rotatie (°)',-360,360,1],['height','Montagehoogte (m)',0,10,.01],['tilt','Kanteling (°)',-90,90,1],['fov_range','Bereik (m)',.1,6,.1],['fov_start','Beginhoek (°)',-60,60,1],['fov_end','Eindhoek (°)',-60,60,1]]){
   const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=step;input.value=typeof s[key]==='number'?Number(s[key].toFixed(3)):({scale:1,smoothing_ms:180,trail_seconds:8}[key]??'');input.dataset.field=key;l.append(input);(['scale','fov_range','fov_start','fov_end'].includes(key)?coverage:['smoothing_ms','trail_seconds'].includes(key)?motion:advanced).append(l);
   input.onchange=()=>this._try(()=>{if(!input.value.trim()&&key!=='height')throw Error('A numeric value is required');this._changePose({[key]:input.value.trim()?Number(input.value):null});});
  }
  const label=document.createElement('label');label.textContent='Montage';const select=document.createElement('select');select.dataset.field='mounting';
  for(const value of ['wall','ceiling']){const option=document.createElement('option');option.value=value;option.textContent=value==='wall'?'Wand':'Plafond';select.append(option);}select.value=s.mounting;select.onchange=()=>this._try(()=>this._changePose({mounting:select.value}));label.append(select);advanced.append(label);
  const done=document.createElement('button');done.dataset.placementCheck='';done.className='primary';done.textContent=s.calibrated?'Plaatsing gecontroleerd':'Plaatsing visueel gecontroleerd';done.onclick=()=>this._try(()=>{this._changePose({calibrated:true});this._fields();});root.append(done);
  const name=document.createElement('input');name.value=s.name;name.dataset.field='name';name.setAttribute('aria-label','Sensor name');name.onchange=()=>this._try(()=>this._changePose({name:name.value}));const nameLabel=document.createElement('label');nameLabel.textContent='Sensornaam';nameLabel.append(name);root.prepend(nameLabel);
  const sourceLabel=document.createElement('label');sourceLabel.textContent='Roomnode of target-entiteit';const source=document.createElement('select');source.id='source';sourceLabel.append(source);root.prepend(sourceLabel);
  source.onchange=()=>this._try(()=>{const value=source.value,[kind,...parts]=value.split(':');const h={...this._config.hardware[s.id],targets:[]};delete h.device_id;delete h.source_entity;delete h.entity_prefix;if(kind==='device')h.device_id=parts.join(':');if(kind==='entity')h.source_entity=parts.join(':');this._changeHardware(h);this._fields();});
  for(const [key,labelText]of [['flip_x','Spiegel links/rechts'],['flip_y','Spiegel voor/achter']]){
   const label=document.createElement('label'),box=document.createElement('input');label.textContent=labelText;box.type='checkbox';box.checked=!!this._config.hardware[s.id]?.[key];box.dataset.field=key;box.onchange=()=>this._try(()=>this._changeHardware({...this._config.hardware[s.id],[key]:box.checked}));label.append(box);coverage.append(label);
  }
  const fov=document.createElement('label'),box=document.createElement('input');fov.textContent='Toon detectieveld';box.type='checkbox';box.checked=s.show_fov!==false;box.dataset.field='show_fov';box.onchange=()=>this._try(()=>this._changePose({show_fov:box.checked}));fov.append(box);coverage.append(fov);
  const diagnostic=document.createElement('p');diagnostic.id='discovery';diagnostic.setAttribute('role','status');root.append(diagnostic);
  this._sourceOptions();
  const refresh=document.createElement('button');refresh.textContent='Apparaten vernieuwen';refresh.onclick=()=>{if(this._hass?.connection)floorRegistryCache.delete(this._hass.connection);this._registry=null;this.hass=this._hass;};root.append(refresh);
  const hint=document.createElement('p');hint.textContent='Alleen weergave: hardware en zones veranderen niet. Plafondmontage en kanteling worden opgeslagen, maar tonen nog geen geprojecteerde targets.';root.append(hint);
  const tools=document.createElement('div');tools.id='polygon-tools';root.append(tools);if(this._hass)this._preview._appendPolygonEditor(tools,s,this._preview._source(s));
 }
 _changeHardware(h){this._emit({...this._config,hardware:{...this._config.hardware,[this._selected]:h}});}
 _sourceOptions(){
  const select=this.shadowRoot.querySelector('#source'),s=this._selectedPose();if(!select||!s)return;
  const h=this._config.hardware[s.id]||{},selected=h.device_id?`device:${h.device_id}`:h.source_entity?`entity:${h.source_entity}`:'';
  select.replaceChildren();const add=(value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o);};add('','Choose roomnode…');
  const registry=this._registry||{entities:[],devices:[]};
  const devices=new Set((registry.entities||[]).filter(e=>[e.entity_id,e.original_name,e.unique_id].some(v=>/target[ _]\d+[ _][xy]$/i.test(v||''))).map(e=>e.device_id));
  for(const d of registry.devices||[])if(devices.has(d.id))add(`device:${d.id}`,d.name_by_user||d.name||d.id);
  for(const [id,state]of Object.entries(this._hass?.states||{}))if(/target_\d+_[xy]$/.test(id))add(`entity:${id}`,`${state.attributes?.friendly_name||id} (${id})`);
  if(selected&&![...select.options].some(o=>o.value===selected))add(selected,`Saved source (${selected}) — unavailable`);
  select.value=selected;
  const resolved=floorResolve(this._hass,h,registry),diagnostic=this.shadowRoot.querySelector('#discovery');
  if(diagnostic)diagnostic.textContent=`${resolved.targets.length} target pairs · ${Object.keys(resolved.polygons).length} polygons. ${resolved.warnings.join(' ')}`;
 }
 _changePose(patch){
  // Moving any physical pose invalidates its previous calibration.
  const invalidate=['x','y','yaw','height','tilt','mounting','scale'].some(k=>Object.hasOwn(patch,k));
  this._emit({...this._config,placements:this._config.placements.map(s=>s.id===this._selected?{...s,...patch,...(invalidate?{calibrated:false}:{})}:s)});
  if(invalidate){const button=this.shadowRoot.querySelector('[data-placement-check]');if(button)button.textContent='Plaatsing visueel gecontroleerd';}
 }
 _point(e){
  const svg=this._preview.shadowRoot.querySelector('svg'),m=svg.getScreenCTM();if(!m)throw Error('SVG is not visible');
  const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());return floorFromMap([p.x,p.y]);
 }
 _down(e){
  if(e.button!==0)return;
  const path=e.composedPath(),g=path.find(n=>n.getAttribute?.('data-sensor')),handle=path.find(n=>n.getAttribute?.('data-rotate'));
  if(!g)return;
  this._selected=g.getAttribute('data-sensor');this.shadowRoot.querySelector('#sensor').value=this._selected;this._fields();
  const [x,y]=this._point(e),s=this._selectedPose();this._drag={pointer:e.pointerId,rotate:!!handle,dx:s.x-x,dy:s.y-y};
  this._preview.setPointerCapture(e.pointerId);e.preventDefault();
 }
 _move(e){
  if(!this._drag||e.pointerId!==this._drag.pointer)return;e.preventDefault();
  this._try(()=>{const[x,y]=this._point(e),s=this._selectedPose();let patch;
   if(this._drag.rotate){if(Math.hypot(x-s.x,y-s.y)<.05)return;patch={yaw:Math.atan2(y-s.y,x-s.x)*180/Math.PI};}
   else patch={x:x+this._drag.dx,y:y+this._drag.dy};
   this._changePose(patch);
   for(const[k,v]of Object.entries(patch))this.shadowRoot.querySelector(`[data-field="${k}"]`).value=Number(v.toFixed(3));
  });
 }
 _end(e){if(this._drag?.pointer===e.pointerId){this._drag=null;if(this._preview.hasPointerCapture(e.pointerId))this._preview.releasePointerCapture(e.pointerId);}}
}
if(!customElements.get('jarvis-floorplan-card'))customElements.define('jarvis-floorplan-card',JarvisFloorplanCard);
if(!customElements.get('jarvis-floorplan-card-editor'))customElements.define('jarvis-floorplan-card-editor',JarvisFloorplanCardEditor);
if(!window.customCards.some(x=>x.type==='jarvis-floorplan-card'))window.customCards.push({type:'jarvis-floorplan-card',name:'Jarvis Ground Floor',description:'Roomnodes, smooth live targets and ESPHome polygons on one floorplan'});
