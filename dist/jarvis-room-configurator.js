/* Jarvis Room Configurator v0.7.0 - LD2460 local-coordinate zone editor.
 * Own implementation; no third-party frontend source code copied.
 * Zone data is stored by ESPHome text entities (mm), not by this card.
 */
class JarvisTargetCard extends HTMLElement {
  constructor() { super(); this.attachShadow({mode:'open'}); this._draft = null; this._selection='zone:1'; this._drawing=false; this._drag=-1; this._targetPos=new Map(); this._trails=new Map(); this._lastFrame=0; this._raf=0; this._pendingStatus=false; }
  setConfig(config) {
    if (typeof config.entity_prefix !== 'string' || !config.entity_prefix.startsWith('sensor.')) throw new Error('entity_prefix must start with sensor.');
    this._config={title:'Jarvis — LD2460',range:5,flip_x:false,flip_y:false,smoothing_ms:180,trail_seconds:8,...config};
    if (!Number.isFinite(+this._config.range)||+this._config.range<=0) throw new Error('range must be positive');
    if (!Number.isFinite(+this._config.smoothing_ms)||+this._config.smoothing_ms<0||+this._config.smoothing_ms>2000) throw new Error('smoothing_ms must be 0..2000');
    if (!Number.isFinite(+this._config.trail_seconds)||+this._config.trail_seconds<0||+this._config.trail_seconds>60) throw new Error('trail_seconds must be 0..60');
    this._trails.clear(); this._targetPos.clear();
    for (const key of ['flip_x','flip_y']) if (typeof this._config[key] !== 'boolean') throw new Error(`${key} must be boolean`);
    this._build(); if(this._hass) this._render();
  }
  set hass(hass) { this._hass=hass; if (this._config) this._render(); }
  connectedCallback(){ if(this._config&&!this._raf) this._animate(0); }
  disconnectedCallback(){ if(this._raf) cancelAnimationFrame(this._raf); this._raf=0; }
  getCardSize(){ return 8; }
  _build(){
    this.shadowRoot.innerHTML=`<style>
      ha-card{padding:16px} h3{margin:0 0 8px;font-size:18px} svg{width:100%;display:block;max-height:520px;touch-action:none;background:var(--secondary-background-color,#f5f5f5);border-radius:8px;cursor:crosshair}
      .grid{stroke:var(--divider-color,#bbb);stroke-width:.6}.label{fill:var(--primary-text-color,#111);font-size:12px}.target{fill:#eca923;stroke:#222;stroke-width:1.2}.trail{fill:none;stroke:#eab308;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
      polygon.zone{fill-opacity:.15;stroke-width:2}polygon.zone.occupied{fill-opacity:.30;stroke-width:3}polygon.exclusion{fill:#e35b5b;fill-opacity:.15;stroke:#e35b5b;stroke-width:2;stroke-dasharray:5 3} .legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px 12px;margin:10px 0;font-size:12px}.legend-item{display:flex;align-items:center;gap:7px}.swatch{width:13px;height:13px;border-radius:3px;flex:none;border:1px solid currentColor}.legend small{color:var(--secondary-text-color,#666)}
      .vertex{fill:#fff;stroke:#227db5;stroke-width:2;cursor:move}.tools{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;align-items:center}select,button{font:inherit;padding:5px 8px}button:disabled{opacity:.45}
      .status{font-size:12px;color:var(--secondary-text-color,#666);margin-top:8px;overflow-wrap:anywhere}.error{color:#c83737}.active{background:#2d7d97;color:white}
    </style><ha-card><h3></h3><div class="tools"><label>Zone <select id="zone"></select></label><button id="draw">Draw new</button><button id="finish">Finish</button><button id="clear">Clear</button><button id="reload">Reload</button><button id="save">Apply to ESPHome</button></div><svg viewBox="0 0 360 360" role="img" aria-label="Live LD2460 targets and polygon editor"></svg><div class="legend" id="legend" aria-live="polite"></div><div class="status" id="status"></div></ha-card>`;
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
  _readTargets(){const prefix=this._config.entity_prefix.toLowerCase();const pairs=new Map();for(const [id,state] of Object.entries(this._hass?.states||{})){
      if(!id.startsWith(prefix))continue;const m=id.match(/^(.*(?:tracking_)?target_([1-5]))_(x|y)$/);if(!m)continue;if(!pairs.has(m[2]))pairs.set(m[2],{});pairs.get(m[2])[m[3]]=state;
    }
    let found=0;const coords=new Map();for(const [id,axes] of pairs){if(!axes.x||!axes.y)continue;found++;
      const convert=s=>{const n=Number(s.state),unit=(s.attributes.unit_of_measurement||'').toLowerCase();return ['unknown','unavailable',''].includes(s.state)||!Number.isFinite(n)?NaN:unit==='mm'?n/1000:unit==='cm'?n/100:unit==='m'?n:NaN;};
      const x=convert(axes.x),y=convert(axes.y);if(!Number.isFinite(x)||!Number.isFinite(y)||y<0||(x===0&&y===0))continue;coords.set(id,this._transform(x,y));
    }return {coords,found};
  }
  _render(){const svg=this.shadowRoot.querySelector('svg');if(!svg||!this._hass)return;svg.replaceChildren();const el=(tag,attrs,txt)=>this._el(svg,tag,attrs,txt);
    const range=+this._config.range;for(let i=-Math.floor(range);i<=Math.floor(range);i++){const [px]=this._transform(i,0);if(px>=12&&px<=348)el('line',{x1:px,y1:12,x2:px,y2:348,class:'grid'});}
    for(let i=0;i<=Math.floor(range);i++){const [,py]=this._transform(0,i);if(py>=12&&py<=348)el('line',{x1:12,y1:py,x2:348,y2:py,class:'grid'});}
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
  _makeTarget(parent,id,x,y){const el=(tag,attrs,text)=>{const o=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))o.setAttribute(k,v);if(text)o.textContent=text;parent.append(o);};if(x<12||x>348||y<12||y>348)return;el('circle',{cx:x,cy:y,r:7,class:'target'});el('text',{x:x+10,y:y-8,class:'label'},`T${id}`);}
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
if(!customElements.get('jarvis-target-card'))customElements.define('jarvis-target-card',JarvisTargetCard);
window.customCards=window.customCards||[];
if(!window.customCards.some(x=>x.type==='jarvis-target-card'))window.customCards.push({type:'jarvis-target-card',name:'Jarvis Room Configurator',description:'LD2460 live targets and polygon editor'});
