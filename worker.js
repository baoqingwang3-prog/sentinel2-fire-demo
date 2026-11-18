/* Inference worker. Only the three input bands reach this worker. */
const CACHE_NAME = "sentinel2-weights-fp32-v1";
const RAW_MODEL = "https://raw.githubusercontent.com/baoqingwang3-prog/sentinel2-fire-demo/483022f04368c57c46bf19469512613cdc62aa00/model/";
const CDN_MODEL = "https://cdn.jsdelivr.net/gh/baoqingwang3-prog/sentinel2-fire-demo@483022f04368c57c46bf19469512613cdc62aa00/model/";
const localUrl = path => new URL(path, self.location.href).href;
const mb = bytes => (bytes / 1e6).toFixed(1);
let loading;
let stage = "启动识别线程";

function notify(message) {
  self.postMessage({type: "status", message});
}

function enter(name) {
  stage = name;
  notify(name + "…");
}

async function jsonFile(path) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(localUrl(path), {signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(path + " · HTTP " + response.status);
      return await response.json();
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

// Read directly into the final offsets. An active transfer can continue at any
// speed. Only a connection that stops delivering data triggers a new attempt.
async function receive(url, target, signal, onBytes) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, {once: true});
  let idleTimer;
  const arm = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(cancel, 25000);
  };
  try {
    signal.throwIfAborted();
    arm();
    const response = await fetch(url, {signal: controller.signal, credentials: "omit"});
    if (!response.ok) throw new Error("HTTP " + response.status);
    const reader = response.body.getReader();
    let offset = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      arm();
      if (offset + value.length > target.length) throw new Error("分片长度超出预期");
      target.set(value, offset);
      offset += value.length;
      onBytes(offset);
    }
    if (offset !== target.length) throw new Error("分片接收不完整");
  } finally {
    clearTimeout(idleTimer);
    cancel();
    signal.removeEventListener("abort", cancel);
  }
}

async function valid(bytes, sha256) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, b => b.toString(16).padStart(2, "0")).join("") === sha256;
}

async function loadWeights(names, metadata) {
  const files = names.map(name => {
    const file = metadata[name];
    if (!file || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error("模型清单与分片不匹配");
    return {name, ...file};
  });
  let total = 0;
  for (const file of files) {
    file.offset = total;
    total += file.bytes;
  }
  const weights = new Uint8Array(total);
  let cache;
  try { cache = await self.caches.open(CACHE_NAME); } catch { /* Storage can be disabled. */ }
  let received = 0, reused = 0, complete = 0, next = 0, lastUpdate = 0;
  let preferred = 0, line = "主线路";
  let slowPrimary = false, triedCdn = false;
  const speeds = [0, 0, 0];
  const labels = ["主线路", "备用线路", "CDN 备用线路"];
  const stop = new AbortController();
  const active = new Map();
  const report = (force = false) => {
    if (stop.signal.aborted || (!force && performance.now() - lastUpdate < 240)) return;
    lastUpdate = performance.now();
    let partial = 0;
    for (const n of active.values()) partial += n;
    notify("加载模型 " + mb(received + partial) + " / " + mb(total) + " MB · 已校验 " +
      complete + "/" + files.length + " 片 · 复用缓存 " + mb(reused) + " MB · " +
      line + (cache ? "" : "（此窗口无法保存缓存）"));
  };
  report(true);

  async function one(file) {
    const primary = localUrl("./model/" + file.name);
    const dest = weights.subarray(file.offset, file.offset + file.bytes);
    if (cache) {
      try {
        const hit = await cache.match(primary);
        if (hit) {
          const bytes = new Uint8Array(await hit.arrayBuffer());
          if (bytes.length === file.bytes && await valid(bytes, file.sha256)) {
            dest.set(bytes);
            reused += bytes.length;
            received += bytes.length;
            complete++;
            report();
            return;
          }
          await cache.delete(primary);
        }
      } catch { /* Try the network if storage is temporarily unreadable. */ }
    }
    const urls = [primary, RAW_MODEL + file.name, CDN_MODEL + file.name];
    // If the primary is slow, try the next real shard on the CDN once, then
    // prefer the fastest verified source. This probe adds no duplicate traffic.
    let first = preferred;
    if (slowPrimary && !triedCdn) {
      first = 2;
      triedCdn = true;
    }
    const failures = [];
    for (let attempt = 0; attempt < urls.length + 1; attempt++) {
      stop.signal.throwIfAborted();
      const route = (first + attempt) % urls.length;
      const started = performance.now();
      try {
        await receive(urls[route], dest, stop.signal, n => {
          active.set(file.name, n);
          report();
        });
        if (!await valid(dest, file.sha256)) throw new Error("分片校验失败");
      } catch (error) {
        stop.signal.throwIfAborted();
        active.delete(file.name);
        speeds[route] = 0;
        failures[route] = error.name === "AbortError" ? "连接停顿" : error.message;
        line = "正在切换下载线路";
        report(true);
        if (attempt === 1) await new Promise(resolve => setTimeout(resolve, 1200));
        continue;
      }
      active.delete(file.name);
      const elapsed = Math.max(1, performance.now() - started);
      speeds[route] = dest.length / elapsed;
      if (route === 0 && speeds[0] < 250) slowPrimary = true;
      preferred = speeds.indexOf(Math.max(...speeds));
      line = labels[route];
      if (cache) {
        try { await cache.put(primary, new Response(dest)); } catch { cache = undefined; }
      }
      received += dest.length;
      complete++;
      report();
      return;
    }
    throw new Error(file.name + " 下载失败。主线路 " + failures[0] + "，备用线路 " +
      failures[1] + "，CDN " + failures[2] + "。重新运行可复用已缓存分片。");
  }
  async function consume() {
    while (!stop.signal.aborted && next < files.length) await one(files[next++]);
  }
  try {
    await Promise.all(Array.from({length: Math.min(6, files.length)}, consume));
  } catch (error) {
    stop.abort();
    throw error;
  }
  report(true);
  return weights.buffer;
}

async function getModel() {
  if (!loading) {
    loading = (async () => {
      enter("启动浏览器计算引擎");
      if (!self.tf) importScripts("./vendor/tf.min.js", "./vendor/tf-backend-wasm.min.js");
      tf.wasm.setWasmPaths(localUrl("./vendor/"));
      tf.wasm.setThreadsCount(1);
      if (!await tf.setBackend("wasm")) throw new Error("浏览器未能启动 WebAssembly");
      await tf.ready();
      enter("读取模型清单");
      const [config, metadata] = await Promise.all([
        jsonFile("./model/model.json"), jsonFile("./model/shards-v1.json")
      ]);
      const groups = config.weightsManifest;
      enter("加载模型分片");
      const weightData = await loadWeights(groups.flatMap(g => g.paths), metadata);
      enter("已收到全部权重，正在初始化 U-Net");
      return tf.loadLayersModel(tf.io.fromMemory({
        modelTopology: config.modelTopology,
        weightSpecs: groups.flatMap(g => g.weights),
        weightData
      }));
    })().catch(error => { loading = undefined; throw error; });
  }
  return loading;
}
self.onmessage = async ({data}) => {
  let input, scores;
  try {
    const model = await getModel();
    enter("正在逐像素识别");
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
    self.postMessage({type:"error",message:stage + " · " + (error.message || String(error))});
  } finally {
    if (input) input.dispose();
    if (scores) scores.dispose();
  }
};
