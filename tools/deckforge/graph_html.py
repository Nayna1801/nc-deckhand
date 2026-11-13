"""Página interactiva de la red de cartas (un solo fichero HTML, sin dependencias)."""
import json

PAGE = r"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Red de cartas</title>
<style>
:root{--bg:#10131a;--panel:#171c26;--line:#2a3242;--ink:#e8ecf4;--dim:#8d97aa;--accent:#e45cff;
--Blue:#4aa3ff;--Green:#4fd28a;--Red:#ff5d6c;--Yellow:#ffd24a;--concept:#b9c2d6;--answer:#ff9a3d}
*{box-sizing:border-box}html,body{height:100%;margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 ui-monospace,Consolas,monospace}
header{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line);background:var(--panel)}
header h1{font-size:15px;margin:0 8px 0 0;color:var(--accent);letter-spacing:.06em}
input,select,button{background:#0d1017;color:var(--ink);border:1px solid var(--line);padding:6px 8px;font:inherit;min-height:34px}
button{cursor:pointer}button.on{border-color:var(--accent);color:var(--accent)}
main{display:grid;grid-template-columns:1fr minmax(260px,360px);height:calc(100% - 52px)}
canvas{width:100%;height:100%;display:block;touch-action:none}
aside{border-left:1px solid var(--line);background:var(--panel);padding:12px;overflow:auto}
aside h2{font-size:15px;margin:0 0 4px}aside .meta{color:var(--dim);margin-bottom:8px}
aside .txt{border-left:2px solid var(--accent);padding-left:8px;margin:8px 0;color:#cfd6e4}
aside h3{font-size:12px;margin:12px 0 4px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em}
aside a{color:var(--ink);cursor:pointer;display:block;padding:2px 0;border-bottom:1px dotted var(--line)}
aside a:hover{color:var(--accent)}.tag{font-size:11px;color:var(--dim)}
.legend span{display:inline-block;margin-right:10px;font-size:12px;color:var(--dim)}
.legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px}
@media(max-width:760px){main{grid-template-columns:1fr;grid-template-rows:58% 42%}aside{border-left:0;border-top:1px solid var(--line)}}
</style></head><body>
<header><h1>RED DE CARTAS</h1>
<input id="q" placeholder="buscar carta o concepto" size="22">
<select id="deck"><option value="">todo el catálogo</option></select>
<button id="bA" class="on" data-rel="aporta">aporta</button><button id="bN" class="on" data-rel="necesita">necesita</button>
<button id="bR" data-rel="responde">responde</button><button id="bF" data-rel="flojea">flojea</button><button id="bC" class="on" data-rel="combo">parejas medidas</button>
<span class="legend"><span><i style="background:var(--concept)"></i>concepto</span><span><i style="background:var(--answer)"></i>respuesta</span></span>
</header>
<main><canvas id="c"></canvas><aside id="side"><h2>Toca un nodo</h2><div class="meta">Cada carta se une a los conceptos que aporta, necesita, a los que responde y contra los que flojea. Arrastra para mover, rueda o pellizco para acercar.</div></aside></main>
<script>
const G=__DATA__;
const cv=document.getElementById('c'),ctx=cv.getContext('2d'),side=document.getElementById('side');
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const N=new Map(G.nodes.map(n=>[n.id,Object.assign(n,{x:(Math.random()-.5)*900,y:(Math.random()-.5)*700,vx:0,vy:0})]));
let rels=new Set(['aporta','necesita','combo']),deckSet=null,sel=null,view={x:0,y:0,k:.5},hover=null,drag=null;
const sel_deck=document.getElementById('deck');G.decks.forEach((d,i)=>{const o=document.createElement('option');o.value=i;o.textContent=d.name;sel_deck.appendChild(o)});
function visibleNodes(){if(!deckSet)return G.nodes;const keep=new Set(deckSet);G.edges.forEach(e=>{if(rels.has(e.rel)&&deckSet.has(e.s)&&e.t.startsWith('C:'))keep.add(e.t)});return G.nodes.filter(n=>keep.has(n.id))}
function visibleEdges(vs){const ids=new Set(vs.map(n=>n.id));return G.edges.filter(e=>rels.has(e.rel)&&ids.has(e.s)&&ids.has(e.t))}
let VN=[],VE=[],heat=1;
function refresh(){fitted=false;VN=visibleNodes();VE=visibleEdges(VN);const deg=new Map();VE.forEach(e=>{deg.set(e.s,(deg.get(e.s)||0)+1);deg.set(e.t,(deg.get(e.t)||0)+1)});VN.forEach(n=>n.deg=deg.get(n.id)||0);heat=1}
function col(n){return n.kind==='concept'?css('--concept'):n.kind==='answer'?css('--answer'):css('--'+n.color)||'#999'}
function rad(n){return n.kind==='card'?4+Math.min(6,n.deg*.6):7+Math.min(14,Math.sqrt(n.deg)*1.6)}
function step(){if(heat<.03)return;
for(let i=0;i<VN.length;i++){const a=VN[i];for(let j=i+1;j<VN.length;j++){const b=VN[j];let dx=a.x-b.x,dy=a.y-b.y;if(dx===0&&dy===0){dx=Math.random()-.5;dy=Math.random()-.5}const d2=dx*dx+dy*dy+1;if(d2>250000)continue;const f=700/d2;a.vx+=dx*f;a.vy+=dy*f;b.vx-=dx*f;b.vy-=dy*f}}
VE.forEach(e=>{const a=N.get(e.s),b=N.get(e.t);const dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+.01,f=(d-70)*.02/d;a.vx+=dx*f;a.vy+=dy*f;b.vx-=dx*f;b.vy-=dy*f});
const cap=40*heat+2;VN.forEach(n=>{n.vx=(n.vx-n.x*.004)*.6;n.vy=(n.vy-n.y*.004)*.6;const v=Math.hypot(n.vx,n.vy);if(v>cap){n.vx*=cap/v;n.vy*=cap/v}if(!isFinite(n.vx)||!isFinite(n.vy)){n.vx=n.vy=0}if(n!==drag){n.x+=n.vx;n.y+=n.vy}});
heat*=.99;if(!fitted&&heat<.35){fit();fitted=true}}
let fitted=false;
function fit(){if(!VN.length)return;let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;VN.forEach(n=>{x0=Math.min(x0,n.x);x1=Math.max(x1,n.x);y0=Math.min(y0,n.y);y1=Math.max(y1,n.y)});const w=cv.clientWidth||800,h=cv.clientHeight||600;view.k=Math.min(2.2,Math.max(.15,.9*Math.min(w/(x1-x0+80),h/(y1-y0+80))));view.x=-(x0+x1)/2*view.k;view.y=-(y0+y1)/2*view.k}
const RELCOL={aporta:'#4fd28a',necesita:'#e45cff',responde:'#ff9a3d',flojea:'#ff5d6c',combo:'#ffffff'};
function draw(){const w=cv.width=cv.clientWidth*devicePixelRatio,h=cv.height=cv.clientHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.clearRect(0,0,w,h);ctx.save();ctx.translate(cv.clientWidth/2+view.x,cv.clientHeight/2+view.y);ctx.scale(view.k,view.k);
const near=sel?new Set([sel.id]):null;if(sel)VE.forEach(e=>{if(e.s===sel.id)near.add(e.t);if(e.t===sel.id)near.add(e.s)});
VE.forEach(e=>{const a=N.get(e.s),b=N.get(e.t),on=!sel||e.s===sel.id||e.t===sel.id;ctx.globalAlpha=on?(sel?.9:.28):.04;ctx.strokeStyle=RELCOL[e.rel];ctx.lineWidth=(e.rel==='combo'?1.6:.7+e.w*.25)/view.k**.5;ctx.setLineDash(e.src==='TEXTO'||e.rel==='combo'?[]:[4,3]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()});ctx.setLineDash([]);
VN.forEach(n=>{const on=!near||near.has(n.id);ctx.globalAlpha=on?1:.15;ctx.fillStyle=col(n);ctx.beginPath();if(n.kind==='card')ctx.arc(n.x,n.y,rad(n),0,7);else{const r=rad(n);ctx.rect(n.x-r,n.y-r,2*r,2*r)}ctx.fill();if(n===sel||n===hover){ctx.strokeStyle='#fff';ctx.lineWidth=2/view.k;ctx.stroke()}
if(n.kind!=='card'||view.k>1.25||(near&&near.has(n.id))||n===hover){ctx.fillStyle=n.kind==='card'?'#e8ecf4':col(n);ctx.font=(n.kind==='card'?11:12.5)/view.k+'px ui-monospace,Consolas,monospace';ctx.fillText(n.label,n.x+rad(n)+4/view.k,n.y+4/view.k)}});ctx.restore();ctx.globalAlpha=1}
function loop(){step();draw();requestAnimationFrame(loop)}
function at(ev){const r=cv.getBoundingClientRect(),x=(ev.clientX-r.left-cv.clientWidth/2-view.x)/view.k,y=(ev.clientY-r.top-cv.clientHeight/2-view.y)/view.k;let best=null,bd=1e9;VN.forEach(n=>{const d=(n.x-x)**2+(n.y-y)**2;if(d<bd&&d<(rad(n)+8/view.k)**2){bd=d;best=n}});return {n:best,x,y}}
let pan=null,moved=false,pinch=0;const pts=new Map();
cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);pts.set(e.pointerId,e);moved=false;const h=at(e);if(pts.size===1){if(h.n)drag=h.n;else pan={x:e.clientX-view.x,y:e.clientY-view.y}}});
cv.addEventListener('pointermove',e=>{if(pts.has(e.pointerId))pts.set(e.pointerId,e);if(pts.size===2){const [a,b]=[...pts.values()],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);if(pinch)view.k=Math.min(4,Math.max(.25,view.k*d/pinch));pinch=d;drag=pan=null;return}
if(drag){const h=at(e);drag.x=h.x;drag.y=h.y;heat=Math.max(heat,.3);moved=true}else if(pan){view.x=e.clientX-pan.x;view.y=e.clientY-pan.y;moved=true}else hover=at(e).n});
cv.addEventListener('pointerup',e=>{pts.delete(e.pointerId);pinch=0;if(!moved){const h=at(e);select(h.n)}drag=pan=null});
cv.addEventListener('wheel',e=>{e.preventDefault();view.k=Math.min(4,Math.max(.25,view.k*(e.deltaY<0?1.12:.89)))},{passive:false});
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function select(n){sel=n;if(!n){side.innerHTML='<h2>Toca un nodo</h2>';return}
const by={aporta:[],necesita:[],responde:[],flojea:[],combo:[]};G.edges.forEach(e=>{if(e.s===n.id)by[e.rel].push([e.t,e]);else if(e.t===n.id)by[e.rel].push([e.s,e])});
const T=n.kind==='card'?{aporta:'Aporta',necesita:'Necesita',responde:'Responde a',flojea:'Flojea contra',combo:'Rinde mejor junto a (medido)'}:{aporta:'Lo dan',necesita:'Lo necesitan',responde:'Lo hacen',flojea:'Son sensibles',combo:''};
let h='<h2>'+esc(n.label)+'</h2>';if(n.kind==='card')h+='<div class="meta">'+esc(n.type)+' · '+esc(n.color)+' · coste '+n.cost+' · poder '+n.power+'</div><div class="txt">'+esc(n.text).replace(/\n/g,'<br>')+'</div>';
for(const r in by){let L=by[r];if(deckSet&&n.kind!=='card')L=L.filter(([id])=>deckSet.has(id));if(!L.length)continue;h+='<h3>'+T[r]+' ('+L.length+')</h3>';L.sort((a,b)=>b[1].w-a[1].w).slice(0,40).forEach(([id,e])=>{const m=N.get(id);h+='<a data-id="'+esc(id)+'">'+esc(m.label)+' <span class="tag">'+(r==='combo'?(e.w>0?'+':'')+Math.round(e.w*100)+'%':e.src)+'</span></a>'})}
side.innerHTML=h;side.querySelectorAll('a').forEach(a=>a.onclick=()=>{const m=N.get(a.dataset.id);select(m);view.x=-m.x*view.k;view.y=-m.y*view.k})}
document.querySelectorAll('header button').forEach(b=>b.onclick=()=>{const r=b.dataset.rel;rels.has(r)?rels.delete(r):rels.add(r);b.classList.toggle('on');refresh()});
sel_deck.onchange=()=>{deckSet=sel_deck.value===''?null:new Set(G.decks[sel_deck.value].cards);refresh()};
document.getElementById('q').oninput=e=>{const q=e.target.value.toLowerCase();if(q.length<2)return;const m=VN.find(n=>n.label.toLowerCase().includes(q));if(m){select(m);view.x=-m.x*view.k;view.y=-m.y*view.k}};
refresh();loop();
</script></body></html>
"""


def render(data):
    return PAGE.replace('__DATA__', json.dumps(data, ensure_ascii=False).replace('</', '<\\/'))
