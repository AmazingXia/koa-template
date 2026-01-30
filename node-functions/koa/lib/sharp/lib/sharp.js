// 使用动态 require 避免 esbuild 在构建时打包 .node 文件
const fs = require('fs');
const path = require('path');
const os = require('os');

let sharpNative = null;
let loadingPromise = null;

async function loadSharpFromRemote() {
  // 使用字符串拼接隐藏 .node 扩展名，避免 esbuild 识别
  const nodeExt = '.node';
  const tmpPath = path.join(os.tmpdir(), 'sharp-linux-x64' + nodeExt);

  // 如果已经下载过，直接使用
  if (fs.existsSync(tmpPath)) {
    try {
      // 使用 Function 构造函数动态执行 require，esbuild 无法静态分析
      const dynamicRequire = new Function('path', 'return require(path)');
      return dynamicRequire(tmpPath);
    } catch (err) {
      // 如果临时文件损坏，删除后重新下载
      console.warn('临时文件损坏，重新下载:', err.message);
      try {
        fs.unlinkSync(tmpPath);
      } catch (unlinkErr) {
        // 忽略删除错误
      }
    }
  }

  try {
    console.log('📥 从远程下载 sharp 原生模块: https://koa.niumengke.top/img/sharp-linux-x64/lib/sharp-linux-x64.node');
    const remoteUrl = 'https://koa.niumengke.top/img/sharp-linux-x64/lib/sharp-linux-x64' + nodeExt;
    const response = await fetch(remoteUrl);

    if (!response.ok) {
      throw new Error(`下载失败: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 确保临时目录存在
    const tmpDir = os.tmpdir();
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // 保存到临时目录
    fs.writeFileSync(tmpPath, buffer, { mode: 0o755 }); // 设置可执行权限

    console.log('✅ sharp 原生模块下载成功:', tmpPath);

    // 使用 Function 构造函数动态执行 require，esbuild 无法静态分析
    const dynamicRequire = new Function('path', 'return require(path)');
    return dynamicRequire(tmpPath);
  } catch (error) {
    throw new Error('从远程加载 sharp 原生模块失败: ' + error.message);
  }
}

// 直接使用远程加载，避免 esbuild 扫描本地 .node 文件
// 立即开始异步下载（不阻塞）
console.log('📥 开始加载 sharp 原生模块（从远程）...');
loadingPromise = loadSharpFromRemote()
  .then(loaded => {
    sharpNative = loaded;
    loadingPromise = null;
    console.log('✅ sharp 模块从远程加载完成');
    return loaded;
  })
  .catch(remoteErr => {
    loadingPromise = null;
    console.error('❌ 从远程加载失败:', remoteErr.message);
    throw remoteErr;
  });

// 导出一个智能 Proxy，能够同步等待加载完成
// 使用同步轮询机制等待异步加载完成（最多等待 10 秒）
function waitForSharpSync(maxWaitMs = 10000) {
  const startTime = Date.now();
  const checkInterval = 50; // 每 50ms 检查一次

  while (!sharpNative && loadingPromise && (Date.now() - startTime) < maxWaitMs) {
    // 使用同步方式等待（阻塞事件循环）
    // 注意：这不是最佳实践，但为了兼容同步 require，这是必要的
    const end = Date.now() + checkInterval;
    while (Date.now() < end) {
      // busy wait，但限制时间避免无限阻塞
      if (sharpNative) {
        return sharpNative;
      }
    }
  }
  return sharpNative;
}

module.exports = new Proxy({}, {
  get(target, prop) {
    // 如果已经加载完成，直接返回
    if (sharpNative) {
      const value = sharpNative[prop];
      // 如果是函数，需要绑定 this
      if (typeof value === 'function') {
        return value.bind(sharpNative);
      }
      return value;
    }

    // 如果正在加载，尝试同步等待
    if (loadingPromise) {
      const waited = waitForSharpSync();
      if (waited) {
        const value = waited[prop];
        if (typeof value === 'function') {
          return value.bind(waited);
        }
        return value;
      }
      throw new Error('sharp 模块正在从远程加载中，请稍候重试...');
    }

    throw new Error('sharp 模块加载失败，请检查网络连接');
  }
});
