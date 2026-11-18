import {buildView} from "./terrain-view.js";
import {cells,possibleCenters,makeObservation,locate} from "./fire-model.js";

const el=id=>document.getElementById(id);
const experiment=el("experiment"), status=el("status"), pixelCount=cells*cells;
let meta, background, coordinates, dem, points, view;
let truth=null, prediction=null, predictedMask=null, strength=1;

async function asset(path) {
  const response=await fetch("./scene/"+path);
  if(!response.ok)throw new Error(path+" 读取失败（HTTP "+response.status+"）");
  return response;
}
async function binary(path,Type,length) {
  const value=new Type(await (await asset(path)).arrayBuffer());
  if(value.length!==length)throw new Error(path+" 尺寸异常");
  return value;
}
function photoAsset(){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error("RGB 影像读取失败"));
    image.src="./scene/rgb.jpg";
  });
}
function setState(state,message) {
  experiment.dataset.state=state;
  status.textContent=message;
  const locked=state==="loading"||state==="running"||!view;
  for(const id of ["random","clear","strength"])el(id).disabled=locked;
  el("reset").disabled=!view;
}
function coordinatesAt(i) {
  const lon=coordinates[i*2]/1e6, lat=coordinates[i*2+1]/1e6;
  return Math.abs(lat).toFixed(6)+"°"+(lat<0?"S":"N")+"，"+Math.abs(lon).toFixed(6)+"°"+(lon<0?"W":"E");
}
function updateMap(){
  const display=el("truth-toggle").checked;
  if(view)view.show(predictedMask,truth,prediction,display);
  if(truth!==null)el("truth-coord").textContent=display?coordinatesAt(truth):"已隐藏";
}
function fail(message) {
  el("ai-coord").textContent="未完成";
  el("counts").textContent="本次没有识别结果";
  setState("error",message);
}
function finish(result) {
  const mask=new Uint8Array(result.mask);
  if(mask.length!==pixelCount || mask.some(value=>value!==0 && value!==1 && value!==255)) throw new Error("服务器返回的火区掩膜无效");
  const detection=locate(mask);
  predictedMask=mask;
  prediction=detection.point;
  el("ai-coord").textContent=prediction===null?"未检出":coordinatesAt(prediction);
  let distance="—";
  if(truth!==null&&prediction!==null){
    const dx=truth%cells-prediction%cells;
    const dy=Math.floor(truth/cells)-Math.floor(prediction/cells);
    distance=Number((meta.pixelSize*Math.hypot(dx,dy)).toFixed(1))+" 米";
  }
  el("distance").textContent=distance;
  const summary="检出 "+detection.count+" 个火像素 · 最大火斑 "+detection.largest+" 个像素";
  el("counts").textContent=summary;
  updateMap();
  setState("done",truth===null?"原图对照已完成":"模拟点火识别已完成 · 信号 "+Math.round(strength*100)+"%");
}
async function start(i) {
  if(!view||experiment.dataset.state==="running")return;
  if(i!==null&&!points.eligible[i]){
    status.textContent="请选择距影像边缘至少两个像素的有效位置。";
    return;
  }
  truth=i;prediction=null;predictedMask=null;strength=Number(el("strength").value);
  el("distance").textContent="—";el("ai-coord").textContent="识别中…";
  el("truth-coord").textContent=i===null?"未点火":coordinatesAt(i);
  el("counts").textContent="等待模型输出";
  updateMap();
  setState("running","云端正在识别三个波段…");
  try{
    const headers={"Content-Type":"application/octet-stream"};
    const xsrf=document.cookie.split("; ").find(part=>part.startsWith("_xsrf="));
    if(xsrf) headers["X-XSRFToken"]=decodeURIComponent(xsrf.slice(6));
    const bands=makeObservation(background,truth,strength);
    const response=await fetch("../api/infer?id=simulation",{
      method:"POST",headers,body:bands.buffer,cache:"no-store"
    });
    if(!response.ok) {
      const detail=(response.status===429||response.status===503)?"服务器繁忙或暂时不可用":"服务器未完成识别";
      throw new Error(detail+"（HTTP "+response.status+"）");
    }
    finish({mask:await response.arrayBuffer()});
  }catch(error){fail("识别失败 · "+error.message+"。可重新点选或运行原图对照。");}
}
function hover(i) {
  el("probe").textContent=i===null?"":"海拔 "+Math.round(dem[i]).toLocaleString("zh-CN")+" m";
}

el("random").addEventListener("click",()=>start(points.indices[Math.floor(Math.random()*points.indices.length)]));
el("clear").addEventListener("click",()=>start(null));
el("reset").addEventListener("click",()=>view?.reset());
el("truth-toggle").addEventListener("change",updateMap);
try{
  const [metadata,input,geo,relief,rgb]=await Promise.all([
    asset("scene.json").then(r=>r.json()),
    binary("bands.bin",Uint16Array,pixelCount*3),
    binary("coordinates.bin",Int32Array,pixelCount*2),
    binary("terrain.bin",Float32Array,pixelCount),photoAsset()
  ]);
  meta=metadata; background=input;coordinates=geo;dem=relief;
  if(!Number.isFinite(meta.pixelSize)||!Number.isFinite(meta.elevationMin)||!Number.isFinite(meta.elevationMax))throw new Error("场景缺少有效的像素尺度或海拔范围");
  points=possibleCenters(input);
  if(!points.indices.length)throw new Error("影像中缺少可用于模拟的完整像素邻域");
  el("satellite").textContent=meta.satellite;
  el("scene-name").textContent=meta.name;
  el("scene-date").textContent=meta.date+" · "+(meta.pixelSize*cells/1000).toFixed(2)+" km × "+(meta.pixelSize*cells/1000).toFixed(2)+" km";
  el("scene-info").textContent=meta.name+" · "+meta.date+" · "+meta.satellite+"。海拔 "+Math.round(meta.elevationMin).toLocaleString("zh-CN")+"–"+Math.round(meta.elevationMax).toLocaleString("zh-CN")+" 米。支持 "+points.indices.length.toLocaleString("zh-CN")+" 个模拟点火中心。";
  el("sources").textContent="影像来源为 Copernicus Sentinel-2，高程来自 Copernicus DEM GLO-30 数字表面模型。影像编号 "+meta.sourceId+"。火区识别使用 Fusioka 等人发布的 U-Net 权重，三维引擎使用 Three.js。";
  el("credit").textContent=meta.credit+" "+meta.demDisclaimer;
  el("scene-source").href=meta.sources.satellite;
  el("dem-source").href=meta.sources.demLicense;
  view=buildView({dem,photo:rgb,meta,onPick:start,onHover:hover});
  setState("ready","请选择山坡上的位置，或随机点火。");
}catch(error){fail("场景加载失败 · "+error.message);}
