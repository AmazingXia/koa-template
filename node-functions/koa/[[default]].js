import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import fs from 'node:fs';
import path from 'node:path';

// 尝试使用 ES6 import 导入本地 sharp（让构建系统自动处理）
let sharp = null;
let sharpError = null;
let sharpLoaded = false;

// 延迟加载 sharp 的函数 - 使用本地 sharp 实现
async function loadSharp() {
  if (sharpLoaded) {
    return { sharp, sharpError };
  }

  sharpLoaded = true;
  try {
    // 优先尝试使用本地 sharp 实现
    // EdgeOne Pages 会将 node-functions/koa 下的所有文件打包
    // 所以 sharp 应该放在 node-functions/koa/lib/sharp 目录下
    let sharpModule;
    try {
      // 尝试使用动态 import（ES6 模块）
      // 这样构建系统可能会自动包含这些文件
      try {
        const sharpModule_import = await import('./lib/sharp/lib/index.js');
        sharpModule = sharpModule_import.default || sharpModule_import;
        console.log('✅ 使用本地 Sharp 模块（ES6 import）');
      } catch (importError) {
        console.warn('⚠️  ES6 import 失败，尝试 require:', importError.message);
        // 回退到 require
        const requireFunc = require;
        const possiblePaths = [
          './lib/sharp/lib/index.js',  // node-functions/koa/lib/sharp (优先)
          '../lib/sharp/lib/index.js',
          '../../lib/sharp/lib/index.js'
        ];

        let loaded = false;
        for (const localSharpPath of possiblePaths) {
          try {
            sharpModule = requireFunc(localSharpPath);
            loaded = true;
            console.log('✅ 使用本地 Sharp 模块（require），路径:', localSharpPath);
            break;
          } catch (pathError) {
            console.warn('⚠️  路径失败:', localSharpPath, pathError.message);
          }
        }

        if (!loaded) {
          // 尝试使用绝对路径
          const currentDir = __dirname || '/var/user';
          const possibleAbsolutePaths = [
            path.join(currentDir, 'lib/sharp/lib/index.js'),
            path.join(currentDir, 'node-functions/koa/lib/sharp/lib/index.js')
          ];

          for (const absolutePath of possibleAbsolutePaths) {
            try {
              if (fs.existsSync(absolutePath)) {
                sharpModule = requireFunc(absolutePath);
                loaded = true;
                console.log('✅ 使用本地 Sharp 模块（绝对路径）:', absolutePath);
                break;
              }
            } catch (absError) {
              // 继续尝试
            }
          }

          if (!loaded) {
            throw new Error('所有本地路径都失败');
          }
        }
      }
    } catch (localError) {
      console.warn('⚠️  本地 Sharp 加载失败，尝试使用 npm 包:', localError.message);
      // 回退到 npm 包的 sharp
      const loadModule = new Function('moduleName', 'return require(moduleName)');
      const moduleName = 'sharp';
      sharpModule = loadModule(moduleName);
      console.log('✅ 使用 npm 包的 Sharp 模块');
    }

    sharp = sharpModule.default || sharpModule;
    console.log('✅ Sharp 模块加载成功');
    console.log('📦 Sharp 版本:', sharp.versions?.sharp || 'unknown');
  } catch (error) {
    sharpError = error;
    console.error('❌ Sharp 模块加载失败:', error.message);
    console.error('📋 错误堆栈:', error.stack);
    console.error('💡 提示: 图片压缩功能将不可用');
    console.error('💡 解决方案:');
    console.error('   1. 确保本地 sharp 代码在 node-functions/koa/lib/sharp 目录');
    console.error('   2. 或确保已安装依赖: pnpm install');
    console.error('   3. 检查 EdgeOne Pages 是否支持原生模块');
  }
  return { sharp, sharpError };
}

// Create Koa application
const app = new Koa();
const router = new Router();

// 请求日志中间件
app.use(async (ctx, next) => {
  const start = Date.now();
  console.log(`\n📥 [${new Date().toISOString()}] ${ctx.method} ${ctx.path}`);
  console.log('📋 Query:', ctx.query);
  console.log('📋 Headers:', {
    'content-type': ctx.headers['content-type'],
    'content-length': ctx.headers['content-length']
  });

  await next();

  const ms = Date.now() - start;
  console.log(`📤 [${ctx.status}] 响应时间: ${ms}ms`);
  ctx.set('X-Response-Time', `${ms}ms`);
});

// Body parser middleware - 只处理 JSON 请求，跳过文件上传路由
app.use(async (ctx, next) => {
  // 对于文件上传路由，跳过 bodyParser
  if (ctx.path === '/compress/upload' && ctx.method === 'POST') {
    await next();
  } else {
    return bodyParser({
      enableTypes: ['json'],
      jsonLimit: '10mb'
    })(ctx, next);
  }
});

// Error handling middleware - 增强错误处理和调试信息
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    const status = err.status || 500;
    ctx.status = status;

    // 输出详细错误信息
    console.error('\n❌ 错误发生:');
    console.error('📍 路径:', ctx.method, ctx.path);
    console.error('📋 错误消息:', err.message);
    console.error('📋 错误堆栈:', err.stack);
    console.error('📋 请求体:', ctx.request.body);
    console.error('📋 Query:', ctx.query);

    ctx.body = {
      error: err.message || 'Internal Server Error',
      status: status,
      stack: err.stack,
      path: ctx.path,
      method: ctx.method,
      timestamp: new Date().toISOString()
    };

    ctx.app.emit('error', err, ctx);
  }
});

// 全局错误监听器
app.on('error', (err, ctx) => {
  console.error('🚨 应用级错误:', err.message);
  console.error('📍 上下文:', {
    method: ctx.method,
    path: ctx.path,
    status: ctx.status
  });
});

// 递归读取目录树
function buildDirectoryTree(dirPath, basePath = '', maxDepth = 10, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    return null;
  }

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const tree = {
      name: path.basename(dirPath) || '/',
      path: basePath || '/',
      type: 'directory',
      children: []
    };

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      const relativePath = path.join(basePath, item.name);

      // 跳过隐藏文件和 node_modules
      if (item.name.startsWith('.') && item.name !== '.') {
        continue;
      }

      if (item.isDirectory()) {
        const childTree = buildDirectoryTree(fullPath, relativePath, maxDepth, currentDepth + 1);
        if (childTree) {
          tree.children.push(childTree);
        }
      } else {
        try {
          const stats = fs.statSync(fullPath);
          tree.children.push({
            name: item.name,
            path: relativePath,
            type: 'file',
            size: stats.size,
            modified: stats.mtime.toISOString()
          });
        } catch (err) {
          // 忽略无法访问的文件
          console.warn(`无法读取文件: ${fullPath}`, err.message);
        }
      }
    }

    // 按类型和名称排序：目录在前，文件在后
    tree.children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return tree;
  } catch (error) {
    console.error(`读取目录失败: ${dirPath}`, error.message);
    return null;
  }
}

// Define routes
router.get('/', async (ctx) => {
  try {
    // 获取当前工作目录
    const cwd = process.cwd();
    const rootPath = path.resolve(cwd);

    // 构建目录树
    const directoryTree = buildDirectoryTree(rootPath, '/', 40);

    // 获取当前目录信息
    const currentDirInfo = {
      cwd: cwd,
      root: rootPath,
      __dirname: __dirname || 'unknown',
      __filename: __filename || 'unknown'
    };

    // 检查 sharp 状态
    const { sharp: sharpModule } = await loadSharp();
    const sharpStatus = sharpModule ? '可用' : '不可用';

    ctx.body = {
      message: 'Hello from Koa on Node Functions!',
      endpoints: {
        '/compress': 'POST - 压缩图片（支持 URL 或 base64）',
        '/compress/upload': 'POST - 上传并压缩图片（multipart/form-data）'
      },
      sharp: sharpStatus,
      ...(sharpError && { sharpError: sharpError.message }),
      directory: currentDirInfo,
      tree: directoryTree
    };
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      error: '获取目录树失败',
      message: error.message,
      stack: error.stack
    };
  }
});

/**
 * 图片压缩服务 - 支持 URL 或 base64
 * POST /compress
 * Body: { url?: string, base64?: string, quality?: number, width?: number, height?: number, format?: 'jpeg' | 'png' | 'webp' }
 */
router.post('/compress', async (ctx) => {
  const { url, base64, quality = 80, width, height, format = 'png' } = ctx.request.body;

  console.log('🖼️  图片压缩请求参数:', { url: url ? `${url.substring(0, 50)}...` : null, hasBase64: !!base64, quality, width, height, format });

  if (!url && !base64) {
    ctx.status = 400;
    ctx.body = { error: '请提供 url 或 base64 图片数据' };
    console.warn('⚠️  缺少必要参数: url 或 base64');
    return;
  }

  // 延迟加载并检查 sharp 是否可用
  const { sharp: sharpModule, sharpError: error } = await loadSharp();
  if (!sharpModule) {
    ctx.status = 503;
    ctx.body = {
      error: '图片处理服务不可用',
      message: error?.message || 'Sharp 模块未正确加载',
      solution: '请检查 EdgeOne Pages 是否支持原生模块，或联系管理员',
      stack: error?.stack
    };
    console.error('❌ Sharp 模块不可用，无法处理图片压缩请求');
    return;
  }

  try {
    let imageBuffer;

    // 从 URL 获取图片
    if (url) {
      console.log('🌐 从 URL 获取图片:', url);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`无法获取图片: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer);
      console.log('✅ 图片下载成功，大小:', imageBuffer.length, 'bytes');
    }
    // 从 base64 获取图片
    else if (base64) {
      console.log('📝 从 base64 解码图片，长度:', base64.length);
      const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
      console.log('✅ Base64 解码成功，大小:', imageBuffer.length, 'bytes');
    }

    // 使用 sharp 处理图片
    let sharpInstance = sharpModule(imageBuffer);

    // 调整尺寸
    if (width || height) {
      const resizeOptions = {
        fit: 'inside',
        withoutEnlargement: true
      };
      // 确保 width 和 height 都是数字或 undefined
      const w = width ? parseInt(width) : undefined;
      const h = height ? parseInt(height) : undefined;
      sharpInstance = sharpInstance.resize(w, h, resizeOptions);
    }

    // 根据格式压缩
    let outputBuffer;
    const qualityNum = Math.max(1, Math.min(100, parseInt(quality)));

    switch (format.toLowerCase()) {
      case 'webp':
        outputBuffer = await sharpInstance
          .webp({ quality: qualityNum })
          .toBuffer();
        break;
      case 'png':
        outputBuffer = await sharpInstance
          .png({
            quality: qualityNum,
            compressionLevel: 9
          })
          .toBuffer();
        break;
      case 'jpeg':
      case 'jpg':
      default:
        outputBuffer = await sharpInstance
          .jpeg({ quality: qualityNum })
          .toBuffer();
    }

    // 获取原始和压缩后的信息
    const originalInfo = await sharpModule(imageBuffer).metadata();
    const compressedInfo = await sharpModule(outputBuffer).metadata();
    const originalSize = imageBuffer.length;
    const compressedSize = outputBuffer.length;
    const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2);

    // 返回压缩后的图片和统计信息
    ctx.set('Content-Type', `image/${format === 'jpeg' ? 'jpeg' : format}`);
    ctx.set('Content-Length', compressedSize.toString());
    ctx.set('X-Original-Size', originalSize.toString());
    ctx.set('X-Compressed-Size', compressedSize.toString());
    ctx.set('X-Compression-Ratio', `${compressionRatio}%`);
    ctx.body = outputBuffer;
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      error: '图片压缩失败',
      message: error.message
    };
  }
});

/**
 * 图片压缩服务 - 支持文件上传
 * POST /compress/upload
 * 方式1: 直接 POST 二进制图片数据到 body，参数通过 query string 传递
 * 方式2: FormData 上传（需要 EdgeOne Pages 支持）
 *
 * Query 参数: quality, width, height, format
 */
router.post('/compress/upload', async (ctx) => {
  // 延迟加载并检查 sharp 是否可用
  const { sharp: sharpModule, sharpError: error } = await loadSharp();
  if (!sharpModule) {
    ctx.status = 503;
    ctx.body = {
      error: '图片处理服务不可用',
      message: error?.message || 'Sharp 模块未正确加载',
      solution: '请检查 EdgeOne Pages 是否支持原生模块，或联系管理员',
      stack: error?.stack
    };
    console.error('❌ Sharp 模块不可用，无法处理图片上传压缩请求');
    return;
  }

  try {
    // 从 query 参数获取压缩选项
    const quality = ctx.query.quality || ctx.request.body?.quality || 80;
    const width = ctx.query.width || ctx.request.body?.width;
    const height = ctx.query.height || ctx.request.body?.height;
    const format = (ctx.query.format || ctx.request.body?.format || 'jpeg').toLowerCase();

    // 尝试多种方式获取文件数据
    let imageBuffer;

    // 方式1: 从请求流直接读取（最常用，直接 POST 二进制数据）
    if (ctx.req && ctx.req.readable) {
      const chunks = [];
      for await (const chunk of ctx.req) {
        chunks.push(chunk);
      }
      if (chunks.length > 0) {
        imageBuffer = Buffer.concat(chunks);
      }
    }
    // 方式2: 从 files 对象获取（如果 EdgeOne Pages 提供了文件解析）
    else if (ctx.request.files?.file) {
      const file = ctx.request.files.file;
      if (Buffer.isBuffer(file)) {
        imageBuffer = file;
      } else if (file.buffer) {
        imageBuffer = file.buffer;
      } else if (file.data) {
        imageBuffer = Buffer.from(file.data);
      }
    }
    // 方式3: 从 body 获取（如果已经是 Buffer）
    else if (Buffer.isBuffer(ctx.request.body)) {
      imageBuffer = ctx.request.body;
    }
    // 方式4: 从 body 中的 file 字段获取
    else if (ctx.request.body?.file) {
      const file = ctx.request.body.file;
      if (Buffer.isBuffer(file)) {
        imageBuffer = file;
      } else if (file.buffer) {
        imageBuffer = file.buffer;
      } else if (file.data) {
        imageBuffer = Buffer.from(file.data);
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      ctx.status = 400;
      ctx.body = {
        error: '请上传图片文件或提供图片数据',
        hint: '可以直接 POST 二进制图片数据，或使用 FormData 上传文件'
      };
      return;
    }

    // 使用 sharp 处理图片
    let sharpInstance = sharpModule(imageBuffer);

    // 调整尺寸
    if (width || height) {
      sharpInstance = sharpInstance.resize(
        width ? parseInt(width) : null,
        height ? parseInt(height) : null,
        {
          fit: 'inside',
          withoutEnlargement: true
        }
      );
    }

    // 根据格式压缩
    let outputBuffer;
    const qualityNum = Math.max(1, Math.min(100, parseInt(quality)));

    switch (format.toLowerCase()) {
      case 'webp':
        outputBuffer = await sharpInstance
          .webp({ quality: qualityNum })
          .toBuffer();
        break;
      case 'png':
        outputBuffer = await sharpInstance
          .png({
            quality: qualityNum,
            compressionLevel: 9
          })
          .toBuffer();
        break;
      case 'jpeg':
      case 'jpg':
      default:
        outputBuffer = await sharpInstance
          .jpeg({ quality: qualityNum })
          .toBuffer();
    }

    // 获取原始和压缩后的信息
    const originalInfo = await sharpModule(imageBuffer).metadata();
    const compressedInfo = await sharpModule(outputBuffer).metadata();
    const originalSize = imageBuffer.length;
    const compressedSize = outputBuffer.length;
    const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2);

    // 返回压缩后的图片和统计信息
    ctx.set('Content-Type', `image/${format === 'jpeg' ? 'jpeg' : format}`);
    ctx.set('Content-Length', compressedSize.toString());
    ctx.set('X-Original-Size', originalSize.toString());
    ctx.set('X-Compressed-Size', compressedSize.toString());
    ctx.set('X-Compression-Ratio', `${compressionRatio}%`);
    ctx.set('X-Original-Width', originalInfo.width?.toString() || '');
    ctx.set('X-Original-Height', originalInfo.height?.toString() || '');
    ctx.set('X-Compressed-Width', compressedInfo.width?.toString() || '');
    ctx.set('X-Compressed-Height', compressedInfo.height?.toString() || '');
    ctx.body = outputBuffer;
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      error: '图片压缩失败',
      message: error.message
    };
  }
});

// Use router middleware
app.use(router.routes());
app.use(router.allowedMethods());

// Export handler
export default app;
