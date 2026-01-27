const path = require('path');
const fs = require('fs');

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
const cwd = process.cwd();
const rootPath = path.resolve(cwd);

const directoryTree = buildDirectoryTree(rootPath, '/', 40);

console.error('directoryTree===>', directoryTree)
console.error('cwd===>', cwd)
console.error('rootPath===>', rootPath)
const runtimePlatform = 'linux-x64';

const paths = [
  // path.join(process.cwd(), '/img/sharp-' + runtimePlatform + '/lib/sharp-' + runtimePlatform + '.node'),
  '/img/sharp-' + runtimePlatform + '/lib/sharp-' + runtimePlatform + '.node',
];

let sharp;
const errors = [];
for (const filePath of paths) {
  try {
    sharp = require(filePath);
    break;
  } catch (err) {
    /* istanbul ignore next */
    errors.push({ path: filePath, error: err });
    console.warn('⚠️  加载失败:', filePath, err.message);
  }
}

if (!sharp) {
  console.error(`sharp.node not found for platform ${runtimePlatform}. Tried paths: ${paths.join(', ')}. Errors: ${JSON.stringify(errors.map(e => e.error.message))}`);
}

module.exports = sharp;