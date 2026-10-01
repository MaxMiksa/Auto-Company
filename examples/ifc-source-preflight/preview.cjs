// 供框架媒体采集使用；Python 服务保持在当前前台进程范围内。
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const python = join(__dirname, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const port = process.argv[2];
if (!existsSync(python) || !/^\d+$/.test(port || '')) {
  console.error('请先按 DELIVERY.md 安装 .venv，并传入本地端口。');
  process.exit(1);
}
const child = spawn(python, ['server.py', '--port', port], {
  cwd: __dirname, env: process.env, stdio: 'inherit'
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', error => { console.error(error.message); process.exit(1); });
child.on('exit', code => { process.exit(code === null ? 1 : code); });
