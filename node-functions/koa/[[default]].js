import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';

// 检测是否为开发环境
const isDev = process.env.NODE_ENV !== 'production' || process.env.EDGEONE_DEV === 'true';

// 延迟加载 sharp - 避免在模块加载时失败
let sharp = null;
let sharpError = null;
let sharpLoaded = false;

// 延迟加载 sharp 的函数 - 使用本地 sharp 实现
function loadSharp() {
  if (sharpLoaded) {
    return { sharp, sharpError };
  }

  sharpLoaded = true;
  try {
    // 优先尝试使用本地 sharp 实现（从 src/lib/sharp）
    // 如果失败，回退到 npm 包的 sharp
    let sharpModule;
    try {
      // 使用本地 sharp 实现
      const localSharpPath = '../../src/lib/sharp/lib/index.js';
      const requireFunc = require;
      sharpModule = requireFunc(localSharpPath);
      if (isDev) {
        console.log('✅ 使用本地 Sharp 模块');
      }
    } catch (localError) {
      if (isDev) {
        console.warn('⚠️  本地 Sharp 加载失败，尝试使用 npm 包:', localError.message);
      }
      // 回退到 npm 包的 sharp
      const loadModule = new Function('moduleName', 'return require(moduleName)');
      const moduleName = 'sharp';
      sharpModule = loadModule(moduleName);
      if (isDev) {
        console.log('✅ 使用 npm 包的 Sharp 模块');
      }
    }

    sharp = sharpModule.default || sharpModule;
    if (isDev) {
      console.log('✅ Sharp 模块加载成功');
      console.log('📦 Sharp 版本:', sharp.versions?.sharp || 'unknown');
    }
  } catch (error) {
    sharpError = error;
    console.error('❌ Sharp 模块加载失败:', error.message);
    if (isDev) {
      console.error('📋 错误堆栈:', error.stack);
      console.error('💡 提示: 图片压缩功能将不可用');
      console.error('💡 解决方案:');
      console.error('   1. 确保本地 sharp 代码在 src/lib/sharp 目录');
      console.error('   2. 或确保已安装依赖: pnpm install');
      console.error('   3. 检查 EdgeOne Pages 是否支持原生模块');
    }
  }
  return { sharp, sharpError };
}

// Create Koa application
const app = new Koa();
const router = new Router();

// 请求日志中间件（开发环境）
if (isDev) {
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
} else {
  // 生产环境只记录响应时间
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    ctx.set('X-Response-Time', `${ms}ms`);
  });
}

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

    // 开发环境输出详细错误信息
    if (isDev) {
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
    } else {
      // 生产环境只返回基本错误信息
      ctx.body = {
        error: err.message || 'Internal Server Error',
        status: status
      };
    }

    ctx.app.emit('error', err, ctx);
  }
});

// 全局错误监听器
app.on('error', (err, ctx) => {
  if (isDev) {
    console.error('🚨 应用级错误:', err.message);
    console.error('📍 上下文:', {
      method: ctx.method,
      path: ctx.path,
      status: ctx.status
    });
  }
});

// Define routes
router.get('/', async (ctx) => {
  ctx.body = {
    message: 'Hello from Koa on Node Functions!',
    endpoints: {
      '/compress': 'POST - 压缩图片（支持 URL 或 base64）',
      '/compress/upload': 'POST - 上传并压缩图片（multipart/form-data）'
    },
    sharp: (() => {
      const { sharp: s } = loadSharp();
      return s ? '可用' : '不可用';
    })(),
    ...(sharpError && { sharpError: sharpError.message })
  };
});

/**
 * 图片压缩服务 - 支持 URL 或 base64
 * POST /compress
 * Body: { url?: string, base64?: string, quality?: number, width?: number, height?: number, format?: 'jpeg' | 'png' | 'webp' }
 */
router.post('/compress', async (ctx) => {
  const { url, base64, quality = 80, width, height, format = 'png' } = ctx.request.body;

  if (isDev) {
    console.log('🖼️  图片压缩请求参数:', { url: url ? `${url.substring(0, 50)}...` : null, hasBase64: !!base64, quality, width, height, format });
  }

  if (!url && !base64) {
    ctx.status = 400;
    ctx.body = { error: '请提供 url 或 base64 图片数据' };
    if (isDev) {
      console.warn('⚠️  缺少必要参数: url 或 base64');
    }
    return;
  }

  // 延迟加载并检查 sharp 是否可用
  const { sharp: sharpModule, sharpError: error } = loadSharp();
  if (!sharpModule) {
    ctx.status = 503;
    ctx.body = {
      error: '图片处理服务不可用',
      message: error?.message || 'Sharp 模块未正确加载',
      solution: '请检查 EdgeOne Pages 是否支持原生模块，或联系管理员',
      ...(isDev && { stack: error?.stack })
    };
    if (isDev) {
      console.error('❌ Sharp 模块不可用，无法处理图片压缩请求');
    }
    return;
  }

  try {
    let imageBuffer;

    // 从 URL 获取图片
    if (url) {
      if (isDev) {
        console.log('🌐 从 URL 获取图片:', url);
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`无法获取图片: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer);
      if (isDev) {
        console.log('✅ 图片下载成功，大小:', imageBuffer.length, 'bytes');
      }
    }
    // 从 base64 获取图片
    else if (base64) {
      if (isDev) {
        console.log('📝 从 base64 解码图片，长度:', base64.length);
      }
      const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
      if (isDev) {
        console.log('✅ Base64 解码成功，大小:', imageBuffer.length, 'bytes');
      }
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
  const { sharp: sharpModule, sharpError: error } = loadSharp();
  if (!sharpModule) {
    ctx.status = 503;
    ctx.body = {
      error: '图片处理服务不可用',
      message: error?.message || 'Sharp 模块未正确加载',
      solution: '请检查 EdgeOne Pages 是否支持原生模块，或联系管理员',
      ...(isDev && { stack: error?.stack })
    };
    if (isDev) {
      console.error('❌ Sharp 模块不可用，无法处理图片上传压缩请求');
    }
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
