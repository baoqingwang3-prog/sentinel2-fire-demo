/* Inference worker. Only the three input bands reach this worker. */
importScripts("./vendor/tf.min.js", "./vendor/tf-backend-wasm.min.js");

let loading;
function notify(message) {
  self.postMessage({type: "status", message});
}
async function getModel() {
  if (!loading) {
    loading = (async () => {
      tf.wasm.setWasmPaths(new URL("./vendor/", self.location.href).href);
      tf.wasm.setThreadsCount(1);
      if (!await tf.setBackend("wasm")) throw new Error("浏览器未能启动 WebAssembly");
      await tf.ready();
      notify("正在加载模型…");
      return await tf.loadLayersModel(new URL("./model/model.json", self.location.href).href, {
        onProgress: ratio => notify("正在加载模型 " + Math.round(ratio * 100) + "%")
      });
    })().catch(error => { loading = undefined; throw error; });
  }
  return loading;
}
self.onmessage = async ({data}) => {
  let input, scores;
  try {
    const model = await getModel();
    notify("正在逐像素识别…");
    const bands = new Uint16Array(data.bands);
    const floats = Float32Array.from(bands, value => value / 10000);
    input = tf.tensor4d(floats, [1,256,256,3]);
    scores = model.predict(input);
    const values = await scores.data();
    const mask = new Uint8Array(256 * 256);
    let maxScore = -1, maxIndex = -1;
    for (let i=0; i<mask.length; i++) {
      const b = i*3;
      if (!bands[b] || !bands[b+1] || !bands[b+2]) { mask[i]=255; continue; }
      const score = values[i];
      if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error("模型输出无效");
      mask[i] = score > 0.5 ? 1 : 0;
      if (score > maxScore) { maxScore=score; maxIndex=i; }
    }
    self.postMessage({type:"done", mask:mask.buffer,maxScore,maxIndex}, [mask.buffer]);
  } catch(error) {
    self.postMessage({type:"error",message:error.message || String(error)});
  } finally {
    if (input) input.dispose();
    if (scores) scores.dispose();
  }
};