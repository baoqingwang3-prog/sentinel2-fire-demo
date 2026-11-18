# 卫眸 · 卫星火区识别

[打开云端识别演示](https://2i2c.mybinder.org/v2/gh/baoqingwang3-prog/sentinel2-fire-demo/d61095d83955908c6d42a287ea41a92f6d833b0b?urlpath=proxy%2F7777%2F)。首次打开会启动独立的 Binder 服务器，空闲回收后可用同一链接重开。打开页面可切换有火或无火切片，对照已保存的实测结果。点击「运行 AI 识别」后，服务器用同一套 U-Net 和原始三个波段重新计算，并返回 65,536 字节的预测掩膜。访问者无需登录或下载模型。

在仓库根目录使用 Node.js 22 运行 `node server.cjs` 可启动相同服务，默认端口为 7777。[浏览器本地复算模式](https://baoqingwang3-prog.github.io/sentinel2-fire-demo/?compute=browser) 使用相同权重，首次运行下载约 138 MB。

数据和原始模型由 André Minoro Fusioka、Gabriel Henrique de Almeida Pereira、Bogdan Tomoyuki Nassu 和 Rodrigo Minetto 发布。[作者项目、数据和权重](https://github.com/Minoro/transfer-learning-landsat8-sentinel2) · [论文](https://doi.org/10.1109/JSTARS.2024.3436811) · [原项目许可](licenses/source-CC-BY-4.0.txt)。

用于演示的派生处理包括读出 B12、B11、B8A 三个原始波段，生成可视化和地理坐标表，以及将原始 Keras 权重无量化转换为 TensorFlow.js 分片。像素预处理为 DN / 10000，阈值为得分严格大于 0.5，缺测像素排除。人工标注仅用于评估。

浏览器运行时使用 TensorFlow.js 4.22.0 和同版本 WASM 后端。[TensorFlow.js 项目](https://github.com/tensorflow/tfjs) · [Apache 2.0 许可](licenses/tensorflowjs-APACHE-2.0.txt)。