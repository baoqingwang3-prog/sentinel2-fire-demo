"use strict";
const reviewButton = document.getElementById("review-open");
const reviewBox = document.getElementById("review-box");
let reviewInputs;
let reviewSample;

function selectReview(sample) {
  if (sample !== reviewSample) {
    reviewBox.hidden = true;
    reviewButton.setAttribute("aria-expanded", "false");
  }
  reviewSample = sample;
  reviewButton.hidden = !(sample.live && sample.meta.id === "fire");
}

async function evidence() {
  if (!reviewInputs) {
    reviewInputs = Promise.all(["perimeter.bin", "valid.bin", "dnbr.i16"].map(async file => {
      const response = await fetch("./review/" + file);
      if (!response.ok) throw new Error("证据影像读取失败");
      const data = await response.arrayBuffer();
      if (data.byteLength !== 65536 * (file.endsWith("i16") ? 2 : 1)) throw new Error("证据网格不一致");
      return file.endsWith("i16") ? new Int16Array(data) : new Uint8Array(data);
    })).catch(error => { reviewInputs = undefined; throw error; });
  }
  return reviewInputs;
}

function medianDnbr(values) {
  if (!values.length) return "—";
  values.sort((a, b) => a-b);
  const mid = Math.floor(values.length / 2);
  return ((values[mid] + values[Math.floor((values.length-1)/2)]) / 20000).toFixed(3);
}

reviewButton.onclick = async () => {
  if (!reviewBox.hidden) {
    reviewBox.hidden = true;
    reviewButton.setAttribute("aria-expanded","false");
    return;
  }
  const sample = reviewSample;
  if (!sample?.live || sample.meta.id !== "fire") return;
  reviewBox.hidden = false;
  reviewButton.setAttribute("aria-expanded","true");
  const status = document.getElementById("review-result");
  status.textContent = "正在叠加事件边界…";
  try {
    const [perimeter, valid, changes] = await evidence();
    if (sample !== reviewSample) return;
    const ctx = document.getElementById("review-scene").getContext("2d");
    ctx.drawImage(sample.img, 0, 0, 256, 256);
    const frame = ctx.getImageData(0, 0, 256, 256);
    const fireValues = [], otherValues = [];
    let detected = 0, matched = 0;
    for (let i=0; i<sample.mask.length; i++) {
      const prediction = sample.mask[i];
      if (prediction === 1) {
        detected++;
        matched += perimeter[i];
        frame.data.set([255,172,50], i*4);
      } else if (perimeter[i] && ((i%256>0 && !perimeter[i-1]) || (i%256<255 && !perimeter[i+1]) ||
          (i>=256 && !perimeter[i-256]) || (i<65280 && !perimeter[i+256]))) {
        frame.data.set([100,244,220], i*4);
      }
      if (valid[i] && changes[i] !== 32767 && prediction !== 255) {
        (prediction === 1 ? fireValues : otherValues).push(changes[i]);
      }
    }
    ctx.putImageData(frame,0,0);
    status.textContent = matched+" / "+detected+" 个预测像素中心落在最终过火边界内";
    document.getElementById("review-change").textContent = "两期可比的判火像素 "+fireValues.length+" 个。dNBR 中位数：判火区 "+medianDnbr(fireValues)+"，其余可比区域 "+medianDnbr(otherValues)+"。";
    reviewBox.scrollIntoView({behavior:"smooth", block:"nearest"});
  } catch (error) {
    if (sample === reviewSample) status.textContent = error.message+"，收起后可重试。";
  }
};
