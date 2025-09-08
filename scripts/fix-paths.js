#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const buildDir = 'build';

// 修复 HTML 文件中的绝对路径为相对路径
function fixHtmlPaths() {
  const htmlFiles = readdirSync(buildDir).filter(file => file.endsWith('.html'));
  
  htmlFiles.forEach(file => {
    const filePath = join(buildDir, file);
    let content = readFileSync(filePath, 'utf-8');
    
    // 修复脚本路径：/script-xxx.js -> ./script-xxx.js
    content = content.replace(/src="\/script-([^"]+)\.js"/g, 'src="./script-$1.js"');
    
    // 修复其他绝对路径
    content = content.replace(/href="\/([^"]+)"/g, 'href="./$1"');
    content = content.replace(/src="\/([^"]+)"/g, 'src="./$1"');
    
    writeFileSync(filePath, content);
    console.log(`✅ Fixed paths in ${file}`);
  });
}

console.log('🔧 Fixing Chrome extension paths...');
fixHtmlPaths();
console.log('✅ All paths fixed!');
