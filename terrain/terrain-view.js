import * as THREE from "three";
import {OrbitControls} from "./vendor/three/OrbitControls.js";
import {cells} from "./fire-model.js";

// Vertex centers are exactly the DEM sample centers. The outer half-cell margin
// repeats the border samples so the 5.12 km footprint matches the source raster.
function makeTerrain(dem, pixelSize, low) {
  const nodes=cells+2, span=cells*pixelSize;
  const geometry=new THREE.PlaneGeometry(1,1,nodes-1,nodes-1);
  const positions=geometry.getAttribute("position"), uv=geometry.getAttribute("uv");
  const axis=n => Math.min(cells,Math.max(0,n-.5));
  const sample=n => Math.min(cells-1,Math.max(0,n-1));
  for(let row=0;row<nodes;row++){
    for(let col=0;col<nodes;col++){
      const i=row*nodes+col;
      const u=axis(col)/cells, v=axis(row)/cells;
      positions.setXYZ(i,(u-.5)*span,dem[sample(row)*cells+sample(col)]-low,(v-.5)*span);
      uv.setXY(i,u,1-v);
    }
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const edge=[];
  for(let x=0;x<nodes;x++)edge.push(x);
  for(let y=1;y<nodes;y++)edge.push(y*nodes+nodes-1);
  for(let x=nodes-2;x>=0;x--)edge.push((nodes-1)*nodes+x);
  for(let y=nodes-2;y>=0;y--)edge.push(y*nodes);
  const wallPoints=[], rim=[];
  for(let j=0;j<edge.length;j++) {
    const a=edge[j],b=edge[(j+1)%edge.length];
    const ax=positions.getX(a),ay=positions.getY(a),az=positions.getZ(a);
    const bx=positions.getX(b),by=positions.getY(b),bz=positions.getZ(b);
    const base=-span*.027;
    wallPoints.push(ax,ay,az,bx,by,bz,ax,base,az,bx,by,bz,bx,base,bz,ax,base,az);
    rim.push(ax,ay,az);
  }
  const wall=new THREE.BufferGeometry(),outline=new THREE.BufferGeometry();
  wall.setAttribute("position",new THREE.Float32BufferAttribute(wallPoints,3));wall.computeVertexNormals();
  outline.setAttribute("position",new THREE.Float32BufferAttribute(rim,3));
  return {geometry,wall,outline};
}

function makeTexture(photo) {
  const image=document.createElement("canvas");
  const size=Math.max(cells,photo.naturalWidth);
  image.width=size; image.height=size;
  const ctx=image.getContext("2d");
  function update(mask) {
    ctx.clearRect(0,0,size,size);
    ctx.drawImage(photo,0,0,size,size);
    if (!mask) return;
    ctx.fillStyle="rgba(44,255,206,.84)";
    const step=size/cells;
    for(let i=0;i<mask.length;i++) if(mask[i]===1)ctx.fillRect(i%cells*step,Math.floor(i/cells)*step,step,step);
  }
  update(null);
  return {image,update};
}

export function buildView({dem, photo, meta, onPick, onHover}) {
  const stage=document.getElementById("stage");
  let canvas=document.getElementById("terrain-canvas");
  const pins=[document.getElementById("truth-pin"),document.getElementById("ai-pin")];
  const arrow=document.getElementById("north-arrow");
  const pixel=meta.pixelSize, span=pixel*cells, low=meta.elevationMin;
  const texture=makeTexture(photo);
  let renderer;
  try { renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:"high-performance"}); }
  catch {
    const fallback=canvas.cloneNode(false);canvas.replaceWith(fallback);canvas=fallback;
    document.getElementById("view-mode").textContent="二维俯视 · WebGL 不可用";
    document.getElementById("navigation").textContent="点选影像模拟点火";
    return buildFlatView({stage,canvas,pins,texture,onPick,onHover});
  }
  renderer.setClearColor(0x152820,0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
  const scene=new THREE.Scene();
  const atlas=new THREE.CanvasTexture(texture.image);
  atlas.colorSpace=THREE.SRGBColorSpace;
  atlas.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const {geometry,wall,outline}=makeTerrain(dem,pixel,low);
  const surface=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({map:atlas}));
  scene.add(surface);
  scene.add(new THREE.Mesh(wall,new THREE.MeshLambertMaterial({color:0x554c37,side:THREE.DoubleSide})));
  scene.add(new THREE.LineLoop(outline,new THREE.LineBasicMaterial({color:0xbed0ad,transparent:true,opacity:.58})));
  scene.add(new THREE.HemisphereLight(0xffffff,0xcad2be,1.8));
  const sun=new THREE.DirectionalLight(0xffedd4,1.42);
  sun.position.set(-3500,6200,-1800);scene.add(sun);
  const camera=new THREE.PerspectiveCamera(40,1,5,span*25);
  const controls=new OrbitControls(camera,canvas);
  controls.enablePan=false;controls.enableDamping=false;
  controls.maxPolarAngle=Math.PI*.44;controls.minPolarAngle=.02;
  controls.minDistance=span*.28;controls.maxDistance=span*3.7;
  let truth=null,ai=null,showTruth=true;
  const projected=new THREE.Vector3();
  const ray=new THREE.Raycaster(), pointer=new THREE.Vector2();
  function reset() {
    const rise=meta.elevationMax-low;
    controls.target.set(0,rise*.40,0);
    const backward=new THREE.Vector3(.42,1.01,1.16).normalize();
    const right=new THREE.Vector3().crossVectors(camera.up,backward).normalize();
    const up=new THREE.Vector3().crossVectors(backward,right);
    const tanY=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)), tanX=tanY*camera.aspect;
    const delta=new THREE.Vector3();
    let distance=controls.minDistance;
    // Fit the measured ridge, the foreground slope, and the base on small screens.
    for (const mesh of [geometry,wall]) {
      const vertices=mesh.getAttribute("position");
      for (let i=0;i<vertices.count;i++) {
        delta.fromBufferAttribute(vertices,i).sub(controls.target);
        const lateral=Math.abs(delta.dot(right))/(tanX*.91);
        const vertical=Math.abs(delta.dot(up))/(tanY*.85);
        distance=Math.max(distance,delta.dot(backward)+Math.max(lateral,vertical));
      }
    }
    camera.position.copy(controls.target).addScaledVector(backward,distance);
    camera.lookAt(controls.target);
    controls.update();paint();
  }
  function screenProject(x,y,z) {
    projected.set(x,y,z).project(camera);
    return {x:(projected.x*.5+.5)*stage.clientWidth,y:(.5-projected.y*.5)*stage.clientHeight,z:projected.z};
  }
  function paint() {
    renderer.render(scene,camera);
    for(const [j,i] of [showTruth?truth:null,ai].entries()) {
      if(i===null){pins[j].hidden=true;continue;}
      const point=screenProject((i%cells+.5-cells/2)*pixel,dem[i]-low+3,(Math.floor(i/cells)+.5-cells/2)*pixel);
      pins[j].hidden=point.z<-1||point.z>1;
      pins[j].style.transform="translate("+point.x+"px,"+point.y+"px)";
    }
    const a=screenProject(0,0,0),b=screenProject(0,0,-300);
    arrow.style.transform="rotate("+Math.atan2(b.x-a.x,a.y-b.y)+"rad)";
  }
  function resize() {
    const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);
    camera.aspect=w/h;camera.updateProjectionMatrix();
    renderer.setSize(w,h,false);
    paint();
  }
  controls.addEventListener("change",paint);
  function hit(event) {
    const rect=canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)*2/rect.width-1,1-(event.clientY-rect.top)*2/rect.height);
    ray.setFromCamera(pointer,camera);
    const intersection=ray.intersectObject(surface,false)[0];
    if (!intersection) return null;
    const {x,z}=intersection.point;
    const col=Math.min(cells-1,Math.max(0,Math.floor(x/pixel+cells/2)));
    const row=Math.min(cells-1,Math.max(0,Math.floor(z/pixel+cells/2)));
    return row*cells+col;
  }
  let press=null,hoverEvent=null,hoverFrame=0;
  canvas.addEventListener("pointerdown", e=>{
    if(!e.isPrimary){press=null;return;}
    press=e.button===0?{id:e.pointerId,x:e.clientX,y:e.clientY,dragged:false}:null;
  });
  canvas.addEventListener("pointercancel",()=>{press=null;});
  canvas.addEventListener("pointermove", e=>{
    if(press&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>5)press.dragged=true;
    hoverEvent=e;
    if(!e.buttons&&!hoverFrame)hoverFrame=requestAnimationFrame(()=>{
      hoverFrame=0;if(hoverEvent)onHover(hit(hoverEvent));
    });
  });
  canvas.addEventListener("pointerleave",()=>{hoverEvent=null;onHover(null);});
  canvas.addEventListener("pointerup",e=>{
    const down=press;press=null;
    if (!down || down.id!==e.pointerId || down.dragged || Math.hypot(e.clientX-down.x,e.clientY-down.y)>5) return;
    const i=hit(e);if(i!==null)onPick(i);
  });
  let lastWidth=stage.clientWidth;
  new ResizeObserver(()=>{
    const prev=lastWidth;lastWidth=stage.clientWidth;
    resize();
    if(Math.abs(prev-lastWidth)>prev*.35)reset();
  }).observe(stage);
  resize();reset();canvas.dataset.mode="3d";
  function show(observation,expected,found,visible) {
    texture.update(observation);atlas.needsUpdate=true;truth=expected;ai=found;showTruth=visible;paint();
  }
  return {reset,show};
}

function buildFlatView({stage,canvas,pins,texture,onPick,onHover}) {
  const ctx=canvas.getContext("2d");
  let truth=null,ai=null,visibility=true;
  const frame=()=>{
    const w=stage.clientWidth,h=stage.clientHeight;
    const side=Math.min(w*.86,h*.79);
    return {w,h,side,x:(w-side)/2,y:(h-side)/2};
  };
  function paint(){
    const f=frame();canvas.width=f.w;canvas.height=f.h;
    ctx.drawImage(texture.image,f.x,f.y,f.side,f.side);
    [visibility?truth:null,ai].forEach((i,j)=>{
      pins[j].hidden=i===null;
      if(i!==null)pins[j].style.transform="translate("+(f.x+(i%cells+.5)*f.side/cells)+"px,"+(f.y+(Math.floor(i/cells)+.5)*f.side/cells)+"px)";
    });
  }
  function hit(e) {
    const f=frame(),rect=canvas.getBoundingClientRect();
    const x=Math.floor((e.clientX-rect.left-f.x)*cells/f.side),y=Math.floor((e.clientY-rect.top-f.y)*cells/f.side);
    return x>=0&&y>=0&&x<cells&&y<cells?y*cells+x:null;
  }
  canvas.addEventListener("click",e=>{const i=hit(e);if(i!==null)onPick(i);});
  canvas.addEventListener("pointermove",e=>onHover(hit(e)));
  canvas.addEventListener("pointerleave",()=>onHover(null));
  new ResizeObserver(paint).observe(stage);paint();canvas.dataset.mode="2d";
  return {reset:paint,show(mask,t,p,v){truth=t;ai=p;visibility=v;texture.update(mask);paint();}};
}
