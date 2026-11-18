export const cells = 256;
const endmember = [12000, 4800, 1700];
const disk = [];
for (let dy = -2; dy <= 2; dy++) {
  for (let dx = -2; dx <= 2; dx++) {
    const squared = dx * dx + dy * dy;
    if (squared <= 4) disk.push({offset: dy * cells + dx, weight: Math.exp(-squared / 4)});
  }
}

export function possibleCenters(bands) {
  const valid = new Uint8Array(cells * cells);
  for (let i = 0; i < valid.length; i++) {
    valid[i] = Number(bands[i*3] > 0 && bands[i*3+1] > 0 && bands[i*3+2] > 0);
  }
  const eligible = new Uint8Array(valid.length);
  const indices = [];
  for (let row=2; row<cells-2; row++) {
    for (let col=2; col<cells-2; col++) {
      const i = row*cells+col;
      if (disk.every(p => valid[i+p.offset])) {
        eligible[i] = 1;
        indices.push(i);
      }
    }
  }
  return {eligible, indices};
}

export function makeObservation(bands, point, strength) {
  const input = bands.slice();
  if (point === null) return input;
  for (const {offset, weight} of disk) {
    const first = 3*(point+offset);
    const alpha = strength * weight;
    for (let b=0; b<3; b++) input[first+b] = Math.round(input[first+b]*(1-alpha)+endmember[b]*alpha);
  }
  return input;
}

export function locate(mask) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let largest=0, point=null, count=0;
  for (let start=0; start<mask.length; start++) {
    if (mask[start]!==1 || visited[start]) continue;
    let length=1, sumX=0, sumY=0;
    queue[0]=start;
    visited[start]=1;
    for (let j=0; j<length; j++) {
      const i=queue[j], x=i%cells, y=Math.floor(i/cells);
      sumX+=x; sumY+=y;
      for (let yy=Math.max(0,y-1); yy<=Math.min(cells-1,y+1); yy++) {
        for (let xx=Math.max(0,x-1); xx<=Math.min(cells-1,x+1); xx++) {
          const next=yy*cells+xx;
          if (mask[next]===1 && !visited[next]) {visited[next]=1;queue[length++]=next;}
        }
      }
    }
    count+=length;
    if (length<=largest) continue;
    largest=length;
    let bestDistance=Infinity;
    for (let j=0; j<length; j++) {
      const i=queue[j];
      const d=(i%cells-sumX/length)**2+(Math.floor(i/cells)-sumY/length)**2;
      if (d<bestDistance || (d===bestDistance && i<point)) {point=i;bestDistance=d;}
    }
  }
  return {point, largest, count};
}
