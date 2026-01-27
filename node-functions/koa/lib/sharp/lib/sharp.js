const path = require('path');
const fs = require('fs');

const runtimePlatform = 'linux-x64';

const paths = [
  path.join(process.cwd(), 'img/sharp-' + runtimePlatform + '/lib/sharp-' + runtimePlatform + '.node'),
];

let sharp;
const errors = [];
for (const filePath of paths) {
  try {
    // 先检查文件是否存在
    if (fs.existsSync(filePath)) {
      console.log('✅ 找到 sharp.node 文件:', filePath);
      sharp = require(filePath);
      break;
    }
  } catch (err) {
    /* istanbul ignore next */
    errors.push({ path: filePath, error: err });
    console.warn('⚠️  加载失败:', filePath, err.message);
  }
}

if (!sharp) {
  throw new Error(`sharp.node not found for platform ${runtimePlatform}. Tried paths: ${paths.join(', ')}. Errors: ${JSON.stringify(errors.map(e => e.error.message))}`);
}

module.exports = sharp;