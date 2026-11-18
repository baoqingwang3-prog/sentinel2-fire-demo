"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {pipeline} = require("node:stream");
const infer = require("./api/infer.js");

const root = __dirname;
const portFlag = process.argv.indexOf("--port");
const port = Number(portFlag < 0 ? process.env.PORT || 7777 : process.argv[portFlag + 1]);
const types = {".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json", ".png":"image/png", ".bin":"application/octet-stream", ".jpg":"image/jpeg", ".i16":"application/octet-stream"};
const assets = new Set(["/index.html", "/style.css", "/app.js", "/samples/index.json"]);
for (const id of ["fire", "clear"]) {
  for (const name of ["swir.png", "reference.bin", "baseline.bin", "wgs84.bin", "thumb.png"]) {
    assets.add("/samples/" + id + "/" + name);
  }
}

assets.add("/review.js");
for (const file of ["before.png","after.png","dnbr.i16","valid.bin","perimeter.bin","metadata.json"]) assets.add("/review/" + file);
for (const file of ["index.html","style.css","mountain.js","terrain-view.js","fire-model.js",
  "scene/bands.bin","scene/terrain.bin","scene/coordinates.bin","scene/rgb.jpg","scene/scene.json",
  "vendor/three/three.module.js","vendor/three/three.core.js","vendor/three/OrbitControls.js",
  "vendor/three/LICENSE","licenses/source-CC-BY-4.0.txt"]) assets.add("/terrain/" + file);

http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/infer") {
    Promise.resolve(infer(req, res)).catch(error => {
      console.error("Inference error:", error.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    return;
  }
  const asset = pathname === "/" || pathname === "/terrain/" ? pathname + "index.html" : pathname;
  if (!assets.has(asset) || !["GET","HEAD"].includes(req.method)) {
    res.writeHead(404).end();
    return;
  }
  const filename = path.join(root, asset);
  fs.stat(filename, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", types[path.extname(filename)]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (asset === "/index.html") {
      const html = fs.readFileSync(filename, "utf8").replace('data-inference="browser"', 'data-inference="server"');
      res.setHeader("Cache-Control", "no-store");
      res.end(req.method === "HEAD" ? undefined : html);
      return;
    }
    res.setHeader("Content-Length", stat.size);
    if (req.method === "HEAD") res.end();
    else pipeline(fs.createReadStream(filename), res, () => {});
  });
}).listen(port, "0.0.0.0");
