"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const Module = require("node:module");
const cwd = process.cwd();
const packaged = path.join(cwd, "inference-assets");
const exampleRepo = require("node:fs").existsSync(path.join(cwd, "model", "weights-01.bin"));
const root = exampleRepo ? cwd : packaged;
const revision = "483022f04368c57c46bf19469512613cdc62aa00";
const remoteRoots = [
  "https://raw.githubusercontent.com/baoqingwang3-prog/sentinel2-fire-demo/" + revision + "/model/",
  "https://cdn.jsdelivr.net/gh/baoqingwang3-prog/sentinel2-fire-demo@" + revision + "/model/"
];
const acceptedIds = new Set(["fire", "clear"]);
let modelPromise;
let queue = Promise.resolve();
let pending = 0;

// These are the original TensorFlow.js bundles shipped with the public demo.
// Resolve the WASM backend's tfjs-core import to that exact TensorFlow instance.
async function loadRuntime() {
  const vendor = path.join(root, "vendor");
  const tf = require(path.join(vendor, "tf.min.js"));
  const filename = path.join(vendor, "tf-backend-wasm.min.js");
  const backend = new Module(filename, module);
  backend.filename = filename;
  backend.require = id => id === "@tensorflow/tfjs-core" ? tf : require(id);
  backend._compile(await fs.readFile(filename, "utf8"), filename);
  backend.exports.setWasmPaths(vendor + path.sep);
  backend.exports.setThreadsCount(1);
  if (!await tf.setBackend("wasm")) throw new Error("WASM initialization failed");
  await tf.ready();
  return tf;
}

async function getShard(filename, info) {
  function verify(bytes) {
    if (bytes.length !== info.bytes || createHash("sha256").update(bytes).digest("hex") !== info.sha256)
      throw new Error("Model shard integrity check failed: " + filename);
    return bytes;
  }
  try {
    return verify(await fs.readFile(path.join(root, "model", filename)));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let lastError;
  for (const base of remoteRoots) {
    try {
      const response = await fetch(base + filename, { signal: AbortSignal.timeout(55000) });
      if (!response.ok) throw new Error("Model source returned HTTP " + response.status);
      return verify(Buffer.from(await response.arrayBuffer()));
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function loadModel() {
  const tf = await loadRuntime();
  const modelDir = path.join(root, "model");
  const topology = JSON.parse(await fs.readFile(path.join(modelDir, "model.json"), "utf8"));
  const hashes = JSON.parse(await fs.readFile(path.join(modelDir, "shards-v1.json"), "utf8"));
  const group = topology.weightsManifest[0];
  let size = 0;
  const jobs = group.paths.map(filename => {
    const offset = size;
    size += hashes[filename].bytes;
    return { filename, offset };
  });
  const weights = new Uint8Array(size);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { filename, offset } = jobs[next++];
      weights.set(await getShard(filename, hashes[filename]), offset);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const network = await tf.loadLayersModel(tf.io.fromMemory({
    modelTopology: topology.modelTopology, weightSpecs: group.weights, weightData: weights.buffer
  }));
  return { tf, network };
}

const inputBytes = 256 * 256 * 3 * 2;
async function readObservation(req) {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/octet-stream") {
    throw Object.assign(new Error("Expected a binary image"), {status:415});
  }
  const length = req.headers["content-length"];
  if (length !== undefined && Number(length) !== inputBytes) {
    throw Object.assign(new Error("Incorrect observation size"), {status:Number(length)>inputBytes ? 413 : 400});
  }
  const image = Buffer.alloc(inputBytes);
  let count = 0;
  for await (const chunk of req) {
    if (count + chunk.length > image.length) throw Object.assign(new Error("Observation too large"), {status:413});
    chunk.copy(image, count);
    count += chunk.length;
  }
  if (count !== image.length) throw Object.assign(new Error("Incomplete observation"), {status:400});
  return image;
}

async function compute(id, observation) {
  if (!modelPromise) modelPromise = loadModel().catch(error => { modelPromise = undefined; throw error; });
  const { tf, network } = await modelPromise;
  const raw = observation || await fs.readFile(exampleRepo ? path.join(root, "samples", id, "bands.bin") : path.join(root, "inputs", id + ".bin"));
  const n = 256 * 256;
  if (raw.length !== n * 3 * 2) throw new Error("Invalid sample size");
  const bands = new Uint16Array(raw.buffer, raw.byteOffset, n * 3);
  const start = performance.now();
  const input = tf.tensor4d(Float32Array.from(bands, value => value / 10000), [1,256,256,3]);
  let prediction;
  try {
    prediction = network.predict(input);
    const scores = await prediction.data();
    const mask = Buffer.alloc(n);
    let maxIndex = -1, maxScore = -1;
    for (let i = 0; i < n; i++) {
      if (!bands[3*i] || !bands[3*i+1] || !bands[3*i+2]) { mask[i] = 255; continue; }
      if (!Number.isFinite(scores[i])) throw new Error("Invalid model output");
      mask[i] = scores[i] > 0.5 ? 1 : 0;
      if (scores[i] > maxScore) { maxScore = scores[i]; maxIndex = i; }
    }
    return { mask, maxIndex, maxScore, elapsed: Math.round(performance.now()-start) };
  } finally {
    if (prediction) prediction.dispose();
    input.dispose();
  }
}

module.exports = async function infer(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.headers.origin === "https://baoqingwang3-prog.github.io") {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Expose-Headers", "X-Max-Index, X-Max-Score, X-Inference-Ms");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); res.statusCode = 405; return res.end("Use POST"); }
  const id = new URL(req.url, "http://localhost").searchParams.get("id");
  if (id !== "simulation" && !acceptedIds.has(id)) { res.statusCode = 400; return res.end("Unknown sample"); }
  if (pending >= 3) { res.statusCode = 429; res.setHeader("Retry-After", "5"); return res.end("Server busy"); }
  pending++;
  try {
    const observation = id === "simulation" ? await readObservation(req) : null;
    const computation = queue.then(() => compute(id, observation));
    queue = computation.catch(() => {});
    const {mask, maxIndex, maxScore, elapsed} = await computation;
    res.setHeader("Content-Type","application/octet-stream");
    res.setHeader("Content-Length",mask.length.toString());
    res.setHeader("X-Max-Index",String(maxIndex));
    res.setHeader("X-Max-Score",String(maxScore));
    res.setHeader("X-Inference-Ms",String(elapsed));
    res.end(mask);
  } catch (error) {
    if (error.status) { res.statusCode = error.status; return res.end(error.message); }
    console.error("Server inference failed:", String(error.message).slice(0,250));
    res.statusCode = 503; res.end("Server inference unavailable; please retry.");
  } finally { pending--; }
};
