# 卫眸 · 卫星火区识别

[打开在线演示](https://baoqingwang3-prog.github.io/sentinel2-fire-demo/) · [重庆北碚真实火场识别图](evidence/chongqing-2022/comparison.png)

点一下三维山坡，在实测卫星底图上加入模拟火信号。服务器只收到三个波段的影像，识别结束后，页面把 AI 给出的位置和点击位置叠在一起。可以调弱信号，也可以按「原图对照」看模型会不会误报。首次打开会启动独立的 Binder 服务器，本次公网验收等了约两分钟。访问者无需登录或下载模型。

点顶栏的「返回真实案例」，即可切换有火和无火样本。运行 AI 识别、查看经纬度，再点「复核这个火斑」，可对照当天人工标注、事件最终过火边界和前后两期卫星观测。Bear Creek 这张切片检出 255 个像元，其中 223 个与当天标注重合，32 个误报，漏掉 11 个。无火对照的 1,745 个有效像元检出 0 个。[公网验收记录](evidence/public-e2e.json)

重庆北碚缙云山案例使用 2022 年 8 月 24 日北京时间 11:49:58 的 Sentinel-2B L1C 影像。裁片取公开野外调查区的中心，模型从 65,536 个有效像元中标出 641 个疑似活动火像元。独立同刻火线标注仍待取得。[本次校准与输出](evidence/chongqing-2022/metrics.json) · [三波段 GeoTIFF](evidence/chongqing-2022/raw-l1c.tif) · [预测掩膜 GeoTIFF](evidence/chongqing-2022/prediction.tif) · [野外调查范围](https://doi.org/10.3390/su16229717) · [同次卫星过境研究](https://doi.org/10.3390/rs17010140)

重庆影像署名为 Contains modified Copernicus Sentinel data 2022。三维底图为美国大提顿国家公园的 Sentinel-2 影像及 Copernicus DEM，地形网格与卫星对齐。[场景来源与署名](terrain/scene/scene.json)

在仓库根目录使用 Node.js 22 运行 `node server.cjs` 可启动相同服务，默认端口为 7777。三维盲测路径为 `/terrain/`，真实案例路径为 `/`。[浏览器本地复算模式](https://baoqingwang3-prog.github.io/sentinel2-fire-demo/?compute=browser) 使用相同权重，首次运行下载约 138 MB。

数据和原始模型由 André Minoro Fusioka、Gabriel Henrique de Almeida Pereira、Bogdan Tomoyuki Nassu 和 Rodrigo Minetto 发布。[作者项目、数据和权重](https://github.com/Minoro/transfer-learning-landsat8-sentinel2) · [论文](https://doi.org/10.1109/JSTARS.2024.3436811) · [原项目许可](licenses/source-CC-BY-4.0.txt)。

用于演示的派生处理包括读出 B12、B11、B8A 三个原始波段，生成可视化和地理坐标表，以及将原始 Keras 权重无量化转换为 TensorFlow.js 分片。像素预处理为 DN / 10000，阈值为得分严格大于 0.5，缺测像素排除。人工标注仅用于评估。

浏览器运行时使用 TensorFlow.js 4.22.0 和同版本 WASM 后端。[TensorFlow.js 项目](https://github.com/tensorflow/tfjs) · [Apache 2.0 许可](licenses/tensorflowjs-APACHE-2.0.txt)。
