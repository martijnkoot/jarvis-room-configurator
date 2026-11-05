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
if(!window.customCards.some(x=>x.type==='jarvis-target-card'))window.customCards.push({type:'jarvis-target-card',name:'Jarvis Room Configurator',description:'LD2460 live targets and polygon editor'});

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
function floorValidate(config){
 const defaults=floorDefaults(),c=floorClone({...defaults,...config});
 if(c.geometry_id!=='begane-grond-v9')throw Error('Unsupported geometry_id');
 if(!c.calibration||typeof c.calibration.dimensions_confirmed!=='boolean')throw Error('calibration.dimensions_confirmed must be boolean');
 if(!Array.isArray(c.placements)||c.placements.length>16)throw Error('placements: expected at most 16 sensors');
 const ids=new Set();
 for(const s of c.placements){
  if(typeof s.id!=='string'||!/^[a-z][a-z0-9_-]{0,47}$/.test(s.id)||ids.has(s.id))throw Error('Sensor IDs must be unique and stable');
  ids.add(s.id);
  if(typeof s.name!=='string'||s.name.length>100)throw Error('Sensor name must be text (max 100 characters)');
  floorNumber(s.x,-1000,1000,'x');floorNumber(s.y,-1000,1000,'y');floorNumber(s.yaw,-360,360,'yaw');
  if(s.height!==null)floorNumber(s.height,0,10,'height');
  if(s.calibrated&&s.height===null)throw Error('Record mounting height before confirming pose');floorNumber(s.tilt,-90,90,'tilt');
  if(!['wall','ceiling'].includes(s.mounting)||typeof s.calibrated!=='boolean')throw Error('Invalid mounting/calibrated');
  floorNumber(s.fov_range,.1,6,'fov_range');floorNumber(s.fov_start,-60,60,'fov_start');floorNumber(s.fov_end,-60,60,'fov_end');
  if(s.fov_start>=s.fov_end)throw Error('FOV start must precede end');
 }
 if(!c.hardware||Array.isArray(c.hardware)||typeof c.hardware!=='object')throw Error('hardware must be an object keyed by sensor ID');
 for(const [id,h] of Object.entries(c.hardware)){
  if(!ids.has(id)||!h||typeof h!=='object'||Array.isArray(h))throw Error('hardware must reference a placement');
  for(const k of ['flip_x','flip_y','axes_confirmed'])if(h[k]!==undefined&&typeof h[k]!=='boolean')throw Error(`${k} must be boolean`);
  if(h.mode_entity!==undefined&&(typeof h.mode_entity!=='string'||!/^select\.[a-z0-9_]+$/.test(h.mode_entity)))throw Error('mode_entity must be a select entity ID');
  if(!Array.isArray(h.targets)||h.targets.length>5)throw Error('hardware.targets: expected at most 5 explicit entity pairs');
  const pairs=new Set();
  for(const t of h.targets){
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
 const a=s.yaw*Math.PI/180,rx=x*(h.flip_x?-1:1),forward=y*(h.flip_y?-1:1);
 // Sensor +X = right, +Y = forward; world yaw 0 = +X, +90 = +Y.
 return [s.x+forward*Math.cos(a)+rx*Math.sin(a),s.y+forward*Math.sin(a)-rx*Math.cos(a)];
}
function floorMetres(state){
 const scale={m:1,cm:.01,mm:.001}[state?.attributes?.unit_of_measurement];
 if(!scale||typeof state.state!=='string'||!state.state.trim())return null;
 const n=Number(state.state);return Number.isFinite(n)?n*scale:null;
}
class JarvisFloorplanCard extends HTMLElement {
 constructor(){super();this.attachShadow({mode:'open'});}
 static getStubConfig(){return floorDefaults();}
 static getConfigElement(){return document.createElement('jarvis-floorplan-card-editor');}
 setConfig(config){this._config=floorValidate(config);this._render();}
 set hass(hass){this._hass=hass;this._refreshLive();}
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
   :host{display:block}ha-card{display:block;padding:16px;overflow:hidden}h2{font-size:20px;margin:0 0 8px}
   svg{display:block;width:100%;background:#fafcfe;color:#172b40;touch-action:pan-y;aspect-ratio:14.4/7.8}
   .status{font-size:13px;line-height:1.5} .sensor{cursor:default} .sensor text{font:0.18px sans-serif}
   .fov{opacity:.10;pointer-events:none} .target{stroke:white;stroke-width:.025}
   :host([editing]) svg{touch-action:none}:host([editing]) .sensor{cursor:grab}
  </style><ha-card><h2></h2><div class="status"></div><svg role="img" aria-label="Ground-floor geometry in metres" viewBox="-1.4 -1.3 14.4 7.8" preserveAspectRatio="xMidYMid meet"></svg><p class="status">Model metres; grid 1 m. Schematic sectors, without wall occlusion. Edit and save this card in Lovelace to persist placement.</p><div id="live-status" class="status" role="status"></div></ha-card>`;
  this.shadowRoot.querySelector('h2').textContent=this._config.title||'Begane grond';
  this.shadowRoot.querySelector('.status').textContent=this._config.calibration.dimensions_confirmed?'Dimensions marked as checked; sensor calibration is separate.':'Uncalibrated prototype: check two independent dimensions and every sensor pose.';
  const svg=this.shadowRoot.querySelector('svg');
  for(let u=0;u<=12;u++)this._node(svg,'line',{x1:u,y1:0,x2:u,y2:5.2,stroke:'#dde5ec','stroke-width':.012});
  for(let v=0;v<=5;v++)this._node(svg,'line',{x1:0,y1:v,x2:11.674,y2:v,stroke:'#dde5ec','stroke-width':.012});
  const sectors=this._node(svg,'g',{'data-layer':'sectors'});
  for(const [a,b] of jarvisGroundFloor.segments){const [x1,y1]=floorToMap(a),[x2,y2]=floorToMap(b);this._node(svg,'line',{x1,y1,x2,y2,stroke:'#172b40','stroke-width':.018,'pointer-events':'none'});}
  this._node(svg,'path',{d:'M0,5.55 H1 M0,5.48 V5.62 M1,5.48 V5.62',stroke:'#172b40','stroke-width':.025});
  this._node(svg,'text',{x:0,y:5.9,'font-size':.18},'1 m • model scale, no geographic north');
  for(const [i,s]of this._config.placements.entries()){
   const color=i===0?'#139b32':i===1?'#245aff':'#a548b0',center=floorToMap([s.x,s.y]),tip=floorToMap(floorProject(s,{},0,.5));
   if(s.mounting==='wall'&&s.tilt===0){
    const points=[center];for(let j=0;j<=48;j++){const a=(s.fov_start+(s.fov_end-s.fov_start)*j/48)*Math.PI/180;points.push(floorToMap(floorProject(s,{},s.fov_range*Math.sin(a),s.fov_range*Math.cos(a))));}
    this._node(sectors,'polygon',{points:points.map(p=>p.join(',')).join(' '),fill:color,class:'fov'});
   }
   const g=this._node(svg,'g',{'data-sensor':s.id,class:'sensor',tabindex:this.hasAttribute('editing')?0:-1,role:'img','aria-label':`${s.name}: ${s.x.toFixed(2)}, ${s.y.toFixed(2)} m; yaw ${s.yaw} degrees`});
   this._node(g,'line',{x1:center[0],y1:center[1],x2:tip[0],y2:tip[1],stroke:color,'stroke-width':.055,'pointer-events':'none'});
   this._node(g,'circle',{cx:center[0],cy:center[1],r:.11,fill:color,stroke:'transparent','stroke-width':24,'vector-effect':'non-scaling-stroke'});
   this._node(g,'text',{x:center[0]+.15,y:center[1]-.15,fill:color},s.name);
   if(this.hasAttribute('editing')){this._node(g,'circle',{cx:tip[0],cy:tip[1],r:.085,fill:'white',stroke:color,'stroke-width':.035,'pointer-events':'none'});this._node(g,'circle',{cx:tip[0],cy:tip[1],r:.085,fill:'white',stroke:'transparent','stroke-width':12,'vector-effect':'non-scaling-stroke','data-rotate':s.id});}
  }
  this._liveLayer=this._node(svg,'g',{'data-layer':'targets','pointer-events':'none'});this._refreshLive();
 }
 _reason(s){
  const h=this._config.hardware[s.id];
  if(s.mounting!=='wall'||s.tilt!==0)return 'ceiling/tilted projection not implemented';
  if(!this._config.calibration.dimensions_confirmed||!s.calibrated)return 'dimensions or pose not calibrated';
  if(!h||!h.axes_confirmed)return 'hardware axes not confirmed';
  if(h.mode_entity&&this._hass?.states?.[h.mode_entity]?.state!=='side')return 'device mode is not confirmed side';
  if(!h.targets.length)return 'no target entity pairs configured';
  return null;
 }
 _refreshLive(){
  if(!this._liveLayer||!this._config)return;
  this._liveLayer.replaceChildren();const status=[];
  for(const [i,s]of this._config.placements.entries()){
   const reason=this._reason(s);if(reason){status.push(`${s.name}: ${reason}`);continue;}
   const h=this._config.hardware[s.id];let count=0;
   for(const [j,t]of h.targets.entries()){
    const x=floorMetres(this._hass?.states?.[t.x_entity]),y=floorMetres(this._hass?.states?.[t.y_entity]);
    // Unknown/unavailable, absent units and the firmware's empty (0,0) slot are omitted.
    if(x===null||y===null||(x===0&&y===0)||Math.hypot(x,y)>6)continue;
    const [cx,cy]=floorToMap(floorProject(s,h,x,y));count++;
    this._node(this._liveLayer,'circle',{cx,cy,r:.085,fill:i===0?'#139b32':'#245aff',class:'target'});
    this._node(this._liveLayer,'text',{x:cx+.12,y:cy,'font-size':.16},`${s.name} T${j+1}`);
   }
   status.push(`${s.name}: ${count} valid target slots (no identity/fusion)`);
  }
  this.shadowRoot.querySelector('#live-status').textContent=status.join(' · ');
 }
}
class JarvisFloorplanCardEditor extends HTMLElement {
 constructor(){super();this.attachShadow({mode:'open'});this._selected='kantoor';}
 set hass(hass){this._hass=hass;if(this._preview)this._preview.hass=hass;}
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
  this.shadowRoot.innerHTML=`<style>:host{display:block}label{display:inline-flex;flex-direction:column;gap:4px;margin:6px;max-width:100%;font:14px system-ui}input,select,button,textarea{font:inherit;box-sizing:border-box;max-width:100%}input[type=number]{width:135px}textarea{display:block;width:100%;min-height:170px}#error{color:var(--error-color,#b42318)}p{line-height:1.5}button{margin:6px}jarvis-floorplan-card{display:block}</style>
   <p>Drag a sensor circle to move; drag its white handle to rotate. Numeric fields also support keyboard editing. Save the Lovelace card/dashboard to persist. These controls never write to ESPHome.</p>
   <jarvis-floorplan-card editing></jarvis-floorplan-card><label>Sensor<select id="sensor"></select></label><div id="fields"></div>
   <label><span>Two independent physical dimensions checked</span><input id="dimensions" type="checkbox"></label>
   <details><summary>Hardware entity mapping (separate from placement)</summary><p>Explicit sensor IDs → targets [{x_entity, y_entity}], flip_x, flip_y, axes_confirmed; optional mode_entity. Set axes_confirmed only after a physical coordinate check. No automatic entity discovery or device writes.</p><textarea id="hardware" aria-label="Hardware JSON"></textarea><button id="apply-hardware">Use hardware mapping</button></details>
   <p id="error" role="alert"></p>`;
  this._preview=this.shadowRoot.querySelector('jarvis-floorplan-card');this._preview.setConfig(this._config);if(this._hass)this._preview.hass=this._hass;
  const select=this.shadowRoot.querySelector('#sensor');
  for(const s of this._config.placements){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;select.append(o);}select.value=this._selected||'';
  select.onchange=()=>{this._selected=select.value;this._fields();};this._fields();
  const dimensions=this.shadowRoot.querySelector('#dimensions');dimensions.checked=this._config.calibration.dimensions_confirmed;
  dimensions.onchange=()=>this._try(()=>this._emit({...this._config,calibration:{...this._config.calibration,dimensions_confirmed:dimensions.checked}}));
  const hardware=this.shadowRoot.querySelector('#hardware');hardware.value=JSON.stringify(this._config.hardware,null,2);
  this.shadowRoot.querySelector('#apply-hardware').onclick=()=>this._try(()=>this._emit({...this._config,hardware:JSON.parse(hardware.value)}));
  // Capture on the preview host, which survives redraws. Pointer positions use inverse SVG CTM.
  this._preview.addEventListener('pointerdown',e=>this._down(e));
  this._preview.addEventListener('pointermove',e=>this._move(e));
  this._preview.addEventListener('pointerup',e=>this._end(e));
  this._preview.addEventListener('pointercancel',e=>this._end(e));
  this._preview.addEventListener('lostpointercapture',()=>{this._drag=null;});
 }
 _try(fn){try{fn();this.shadowRoot.querySelector('#error').textContent='';}catch(e){this.shadowRoot.querySelector('#error').textContent=e.message;}}
 _fields(){
  const root=this.shadowRoot.querySelector('#fields');root.replaceChildren();const s=this._selectedPose();if(!s)return;
  for(const [key,label,min,max,step]of [['x','World X (m)',-1000,1000,.01],['y','World Y (m)',-1000,1000,.01],['yaw','Yaw: 0 = +X, 90 = +Y (°)',-360,360,1],['height','Mounting height (m)',0,10,.01],['tilt','Downward tilt (°)',-90,90,1],['fov_range','Display radius (m)',.1,6,.1],['fov_start','Local FOV start (°)',-60,60,1],['fov_end','Local FOV end (°)',-60,60,1]]){
   const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=step;input.value=typeof s[key]==='number'?Number(s[key].toFixed(3)):'';input.dataset.field=key;l.append(input);root.append(l);
   input.onchange=()=>this._try(()=>{if(!input.value.trim()&&key!=='height')throw Error('A numeric value is required');this._changePose({[key]:input.value.trim()?Number(input.value):null});});
  }
  const label=document.createElement('label');label.textContent='Mounting';const select=document.createElement('select');select.dataset.field='mounting';
  for(const value of ['wall','ceiling']){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}select.value=s.mounting;select.onchange=()=>this._try(()=>this._changePose({mounting:select.value}));label.append(select);root.append(label);
  const l=document.createElement('label');l.textContent='Pose physically calibrated';const input=document.createElement('input');input.type='checkbox';input.dataset.field='calibrated';input.checked=s.calibrated;input.onchange=()=>this._try(()=>this._changePose({calibrated:input.checked}));l.append(input);root.append(l);
 }
 _changePose(patch){
  // Moving any physical pose invalidates its previous calibration.
  const invalidate=['x','y','yaw','height','tilt','mounting'].some(k=>Object.hasOwn(patch,k));
  this._emit({...this._config,placements:this._config.placements.map(s=>s.id===this._selected?{...s,...patch,...(invalidate?{calibrated:false}:{})}:s)});
  if(invalidate){const box=this.shadowRoot.querySelector('[data-field="calibrated"]');if(box)box.checked=false;}
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
if(!window.customCards.some(x=>x.type==='jarvis-floorplan-card'))window.customCards.push({type:'jarvis-floorplan-card',name:'Jarvis Ground Floor',description:'Metre floorplan, independent roomnode poses and calibrated live targets'});
