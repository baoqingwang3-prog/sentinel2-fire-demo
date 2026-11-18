# 卫眸 · 卫星火区识别

这份演示用同一套模型分析两张公开的 Sentinel-2 测试切片。页面打开时提供本地 TensorFlow 实测图层，运行按钮在浏览器 Web Worker 中执行完整的 U-Net 推理。首次运行下载约 138 MB 的 float32 权重，图像不会传往服务器。

数据和原始模型由 André Minoro Fusioka、Gabriel Henrique de Almeida Pereira、Bogdan Tomoyuki Nassu 和 Rodrigo Minetto 发布。[作者项目、数据和权重](https://github.com/Minoro/transfer-learning-landsat8-sentinel2) · [论文](https://doi.org/10.1109/JSTARS.2024.3436811) · [原项目许可](licenses/source-CC-BY-4.0.txt)。

用于演示的派生处理包括读出 B12、B11、B8A 三个原始波段，生成可视化和地理坐标表，以及将原始 Keras 权重无量化转换为 TensorFlow.js 分片。像素预处理为 DN / 10000，阈值为得分严格大于 0.5，缺测像素排除。人工标注仅用于评估。

浏览器运行时使用 TensorFlow.js 4.22.0 和同版本 WASM 后端。[TensorFlow.js 项目](https://github.com/tensorflow/tfjs) · [Apache 2.0 许可](licenses/tensorflowjs-APACHE-2.0.txt)。