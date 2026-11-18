"use strict";
const byId = id => document.getElementById(id);
const canvas = byId("scene");
const ctx = canvas.getContext("2d");
const layer = document.createElement("canvas");
layer.width = layer.height = 256;
const layerCtx = layer.getContext("2d");
const results = new Map();
let cases, state, currentMode = "prediction", selectedPixel, zoomed = false;
let frame = {x:0,y:0,side:256};
let ticket=0, busy=false, worker;
const number = value => value.toLocaleString("zh-CN");
const togglePressed = (button, value, activeClass) => {
  button.classList.toggle(activeClass,value);
  button.setAttribute("aria-pressed",String(value));
};
function metrics(mask,ref) {
  const v={tp:0,fp:0,fn:0,tn:0,valid:0};
  for (let i=0;i<mask.length;i++) {
    if (mask[i]===255) continue;
    v.valid++;
    if (mask[i]) { if (ref[i]) v.tp++; else v.fp++; }
    else if (ref[i]) v.fn++; else v.tn++;
  }
  return v;
}
async function get(path,method) {
  const res=await fetch(path);
  if (!res.ok) throw new Error("文件读取失败 ("+res.status+")");
  return res[method]();
}
async function loadCase(id) {
  if (busy) return;
  const turn=++ticket;
  byId("run").disabled=true;
  byId("map").hidden=true;
  const meta=cases.find(c=>c.id===id);
  document.querySelectorAll("[data-case]").forEach(b=>togglePressed(b,b.dataset.case===id,"selected"));
  if (!results.has(id)) {
    const folder="./samples/"+id+"/";
    const [imgBuffer,ref,base,coords]=await Promise.all([
      get(folder+"swir.png","blob"),get(folder+"reference.bin","arrayBuffer"),
      get(folder+"baseline.bin","arrayBuffer"),get(folder+"wgs84.bin","arrayBuffer")
    ]);
    const url=URL.createObjectURL(imgBuffer);
    const img=new Image(); img.src=url; await img.decode(); URL.revokeObjectURL(url);
    results.set(id,{meta,img,ref:new Uint8Array(ref),mask:new Uint8Array(base),
      coords:new Int32Array(coords),baseline:new Uint8Array(base),live:false,
      peakIndex:meta.maxRow*256+meta.maxCol,maxScore:meta.maxScore});
  }
  if(turn!==ticket) return;
  state=results.get(id); zoomed=id==="clear";selectedPixel=undefined;
  byId("case-id").textContent=meta.tile;byId("time").textContent=meta.date+" UTC";
  byId("coverage").textContent=number(meta.valid)+" / 65,536 像素（"+(meta.valid/65536*100).toFixed(2)+"%）";
  byId("zoom").hidden=id!=="clear";
  byId("coordinate").textContent="点选影像查看经纬度";
  byId("run-status").textContent=state.live?"已用浏览器完成复算。":"首次复算需加载约 138 MB，同一浏览器可复用已缓存的模型分片。";
  render();byId("run").disabled=false;
}
function draw() {
  if (!state)return;
  const m=state.meta;
  const [x0,y0,x1,y1]=m.validBounds;
  let side=256,x=0,y=0;
  if(zoomed) {
    side=Math.min(256,Math.max(x1-x0+1,y1-y0+1)+12);
    x=Math.max(0,Math.min(256-side,Math.round((x0+x1-side)/2)));
    y=Math.max(0,Math.min(256-side,Math.round((y0+y1-side)/2)));
  }
  frame={x,y,side};
  byId("zoom").textContent=zoomed?"看整张切片":"放大有效区域";
  layerCtx.drawImage(state.img,0,0);
  const raster=layerCtx.getImageData(0,0,256,256), a=raster.data;
  for(let i=0;i<state.mask.length;i++) {
    const p=state.mask[i],r=state.ref[i],j=i*4;
    if(p===255){
      const stripe=((i%256+Math.floor(i/256))%9)<2;
      const v=stripe?68:55;
      a[j]=v;a[j+1]=v+7;a[j+2]=v+3;continue;
    }
    if(currentMode==="original")continue;
    const gray=Math.round(17+.52*(.28*a[j]+.43*a[j+1]+.29*a[j+2]));
    let color=currentMode==="prediction"?[.78*a[j],.78*a[j+1],.78*a[j+2]]:[gray,gray,gray];
    if(currentMode==="prediction" && p)color=[255,174,66];
    if(currentMode==="compare"){
      if(p&&r)color=[65,213,174];else if(p)color=[255,174,66];else if(r)color=[242,132,190];
    }
    a[j]=color[0];a[j+1]=color[1];a[j+2]=color[2];
  }
  layerCtx.putImageData(raster,0,0);ctx.imageSmoothingEnabled=false;
  ctx.drawImage(layer,x,y,side,side,0,0,512,512);
  if(selectedPixel!==undefined) {
    const col=selectedPixel%256,row=Math.floor(selectedPixel/256);
    const px=(col+.5-x)/side*512,py=(row+.5-y)/side*512;
    ctx.save();ctx.strokeStyle="#172a21";ctx.lineWidth=5;ctx.beginPath();ctx.arc(px,py,8,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle="white";ctx.lineWidth=2;ctx.stroke();ctx.restore();
  }
  const width=canvas.getBoundingClientRect().width;
  const scaleMeters=side>=200?500:200;
  byId("scale-line").style.width=Math.max(12,width*scaleMeters/(side*20))+"px";
  byId("scale-text").textContent=scaleMeters+" m";
}
function legend() {
  const items=currentMode==="compare"?[["teal","预测与标注重合"],["amber","仅预测"],["pink","仅标注"]]:
              currentMode==="prediction"?[["amber","AI 判火"]]:[["","B12 / B11 / B8A 短波红外合成"]];
  if(state.meta.noData)items.push(["nodata","缺测区"]);
  byId("legend").replaceChildren(...items.map(([cls,label])=>{
    const s=document.createElement("span");
    if(cls){const i=document.createElement("i");i.className=cls;s.append(i);}
    s.append(label);return s;
  }));
}
function render() {
  const v=metrics(state.mask,state.ref),pred=v.tp+v.fp;
  byId("count-p").textContent=number(pred);byId("count-r").textContent=number(v.tp+v.fn);
  for(const k of ["tp","fp","fn"])byId(k).textContent=number(v[k]);
  byId("verdict").textContent=pred?"检出疑似活动火区":"有效区域未检出火像素";
  byId("origin").textContent=state.live?"浏览器实算":"已保存的实测";
  byId("locate").hidden=pred===0;
  byId("interpret").textContent=state.meta.id==="fire"?
    ("火区交并比 "+(100*v.tp/(v.tp+v.fp+v.fn)).toFixed(1)+"%。点击影像可核对每个像素的经纬度和标注。"):
    ("本图有效观测仅占 "+(100*v.valid/65536).toFixed(2)+"%，其余区域缺测。误报率按 "+number(v.valid)+" 个有效像素计算。");
  legend();draw();
}
function pick(index) {
  if (!state) return;
  selectedPixel=index;
  const lon=state.coords[index*2]/1e6,lat=state.coords[index*2+1]/1e6;
  const p=state.mask[index],r=state.ref[index];
  const tag=p===255?"缺测":(p?"AI 判火":"AI 无火")+" / "+(r?"人工有火":"人工无火");
  byId("coordinate").textContent=lat.toFixed(5)+"°, "+lon.toFixed(5)+"° · "+tag;
  const map=byId("map");map.hidden=false;
  map.href="https://www.openstreetmap.org/?mlat="+lat+"&mlon="+lon+"#map=14/"+lat+"/"+lon;
  draw();
}
function largestComponentPixel(mask) {
  const seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length);
  let chosen,largest=0;
  for(let start=0;start<mask.length;start++){
    if(mask[start]!==1||seen[start])continue;
    let tail=1,sx=0,sy=0;
    queue[0]=start;seen[start]=1;
    for(let j=0;j<tail;j++){
      const k=queue[j],x=k%256,y=k>>8;sx+=x;sy+=y;
      for(let yy=Math.max(0,y-1);yy<=Math.min(255,y+1);yy++){
        for(let xx=Math.max(0,x-1);xx<=Math.min(255,x+1);xx++){
          const n=yy*256+xx;
          if(mask[n]===1&&!seen[n]){seen[n]=1;queue[tail++]=n;}
        }
      }
    }
    if(tail<=largest)continue;
    largest=tail;let best=Infinity;
    for(let j=0;j<tail;j++){
      const k=queue[j],dd=(k%256-sx/tail)**2+((k>>8)-sy/tail)**2;
      if(dd<best){best=dd;chosen=k;}
    }
  }
  return chosen;
}
function run() {
  if(!state||busy)return;
  const selected=state;
  busy=true;byId("run").disabled=true;
  document.querySelectorAll("[data-case]").forEach(b=>b.disabled=true);
  const done=()=>{busy=false;byId("run").disabled=false;document.querySelectorAll("[data-case]").forEach(b=>b.disabled=false);};
  let phase = "读取输入波段";
  const fail = message => {
    if (!busy) return;
    byId("run-status").textContent = "本次复算失败。" + (message || ("浏览器在“" + phase + "”阶段中断。")) + " 可点击上方按钮重试。";
    if (worker) { worker.terminate(); worker = null; }
    done();
  };
  byId("run-status").textContent="正在读取三个输入波段…";
  try {worker??=new Worker("./worker.js?v=resume-v1");}catch(e){fail(e.message);return;}
  worker.onerror=e=>fail(e.message ? phase + " · " + e.message : "");
  worker.onmessage=({data})=>{
    if(data.type==="status"){phase=data.message;byId("run-status").textContent=phase;return;}
    if(data.type==="error"){fail(data.message);return;}
    if(data.type!=="done")return;
    selected.mask=new Uint8Array(data.mask);selected.live=true;selected.peakIndex=data.maxIndex;selected.maxScore=data.maxScore;
    const differences=selected.mask.reduce((n,v,i)=>n+(v!==selected.baseline[i]),0);
    byId("run-status").textContent=differences?"复算完成；与本地基准有 "+differences+" 个像素不同。":"复算完成，全部 65,536 个像素与本地结果一致。";
    render();if(selectedPixel!==undefined)pick(selectedPixel);done();
  };
  get("./samples/"+selected.meta.id+"/bands.bin","arrayBuffer").then(bands=>worker.postMessage({bands},[bands])).catch(e=>fail(e.message));
}
function showError(e){byId("run-status").textContent="读取失败，请刷新重试。"+e.message;}
document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{
  currentMode=b.dataset.mode;
  document.querySelectorAll("[data-mode]").forEach(t=>togglePressed(t,t===b,"active"));
  if(state){legend();draw();}
});
document.querySelectorAll("[data-case]").forEach(b=>b.onclick=()=>loadCase(b.dataset.case).catch(showError));
byId("run").onclick=run;
byId("zoom").onclick=()=>{zoomed=!zoomed;draw();};
byId("locate").onclick=()=>{const i=largestComponentPixel(state.mask);if(i!==undefined)pick(i);};
canvas.onclick=e=>{
  const rect=canvas.getBoundingClientRect();
  const col=frame.x+Math.min(frame.side-1,Math.max(0,Math.floor((e.clientX-rect.left)/rect.width*frame.side)));
  const row=frame.y+Math.min(frame.side-1,Math.max(0,Math.floor((e.clientY-rect.top)/rect.height*frame.side)));
  pick(row*256+col);
};
canvas.onkeydown=e=>{
  if(!state||!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key))return;
  e.preventDefault();
  const idx=selectedPixel??((frame.y+Math.floor(frame.side/2))*256+frame.x+Math.floor(frame.side/2));
  const col=Math.max(frame.x,Math.min(frame.x+frame.side-1,idx%256+(e.key==="ArrowRight")-(e.key==="ArrowLeft")));
  const row=Math.max(frame.y,Math.min(frame.y+frame.side-1,(idx>>8)+(e.key==="ArrowDown")-(e.key==="ArrowUp")));
  pick(row*256+col);
};
window.addEventListener("resize",draw);
get("./samples/index.json","json").then(list=>{cases=list;return loadCase("fire");}).catch(showError);