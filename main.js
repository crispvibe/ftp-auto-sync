const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const chokidar = require('chokidar');
const { Client } = require('basic-ftp');
const fs = require('fs');

// 配置文件路径 - 使用 userData 目录确保打包后可写
// 开发环境：项目根目录；生产环境：用户数据目录
const configPath = app.isPackaged 
  ? path.join(app.getPath('userData'), 'ftp-configs.json')
  : path.join(__dirname, 'ftp-configs.json');

const watchers = new Map();
const ftpClients = new Map();
const uploadQueue = new Map(); // 上传失败重试队列
const uploadLocks = new Map(); // 上传锁，防止并发上传同一文件
const MAX_RETRIES = 3; // 最大重试次数

// 读取配置文件
function loadConfigs() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('读取配置文件失败:', error);
  }
  return [];
}

// 保存配置文件
function saveConfigs(configs) {
  try {
    // 确保目录存在（生产环境可能需要创建 userData 目录）
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('保存配置文件失败:', error);
    return false;
  }
}

let mainWindow;

function createWindow() {
  const windowOptions = {
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#1a1a1a'
  };

  // macOS 特定样式
  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile('index.html');
  
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function createMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    // macOS 应用菜单
    ...(isMac ? [{
      label: 'FTP',
      submenu: [
        { label: '关于 FTP', role: 'about' },
        { type: 'separator' },
        { label: '服务', role: 'services' },
        { type: 'separator' },
        { label: '隐藏 FTP', accelerator: 'Command+H', role: 'hide' },
        { label: '隐藏其他', accelerator: 'Command+Alt+H', role: 'hideOthers' },
        { label: '显示全部', role: 'unhide' },
        { type: 'separator' },
        { label: '退出', accelerator: 'Command+Q', role: 'quit' }
      ]
    }] : []),
    {
      label: '文件',
      submenu: [
        { label: '新建配置', accelerator: isMac ? 'Command+N' : 'Ctrl+N', click: () => { mainWindow.webContents.send('new-config'); } },
        { type: 'separator' },
        isMac ? { label: '关闭窗口', accelerator: 'Command+W', role: 'close' } : { label: '退出', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: isMac ? 'Command+Z' : 'Ctrl+Z', role: 'undo' },
        { label: '重做', accelerator: isMac ? 'Shift+Command+Z' : 'Ctrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: isMac ? 'Command+X' : 'Ctrl+X', role: 'cut' },
        { label: '复制', accelerator: isMac ? 'Command+C' : 'Ctrl+C', role: 'copy' },
        { label: '粘贴', accelerator: isMac ? 'Command+V' : 'Ctrl+V', role: 'paste' },
        { label: '全选', accelerator: isMac ? 'Command+A' : 'Ctrl+A', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: isMac ? 'Command+R' : 'Ctrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: isMac ? 'Shift+Command+R' : 'Ctrl+Shift+R', role: 'forceReload' },
        { label: '开发者工具', accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', accelerator: isMac ? 'Command+0' : 'Ctrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: isMac ? 'Command+Plus' : 'Ctrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: isMac ? 'Command+-' : 'Ctrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: isMac ? 'Ctrl+Command+F' : 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: isMac ? 'Command+M' : 'Ctrl+M', role: 'minimize' },
        ...(isMac ? [
          { label: '缩放', role: 'zoom' },
          { type: 'separator' },
          { label: '前置全部窗口', role: 'front' }
        ] : [
          { label: '关闭', accelerator: 'Ctrl+W', role: 'close' }
        ])
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '了解更多',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://github.com');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createWindow();
  createMenu();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Stop all watchers
  watchers.forEach(watcher => {
    try {
      watcher.close();
    } catch (error) {
      // 忽略关闭错误
    }
  });
  
  // 清理所有队列和锁
  uploadQueue.clear();
  uploadLocks.clear();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('get-configs', () => {
  return loadConfigs();
});

ipcMain.handle('save-config', (event, config) => {
  const configs = loadConfigs();
  
  if (config.id) {
    const index = configs.findIndex(c => c.id === config.id);
    if (index !== -1) {
      configs[index] = config;
    }
  } else {
    config.id = Date.now().toString();
    config.enabled = false;
    configs.push(config);
  }
  
  saveConfigs(configs);
  return configs;
});

ipcMain.handle('delete-config', (event, id) => {
  const configs = loadConfigs();
  const filtered = configs.filter(c => c.id !== id);
  
  // 使用 stopWatcher 确保完整清理（包括 FTP 客户端和重试队列）
  stopWatcher(id);
  
  saveConfigs(filtered);
  return filtered;
});

ipcMain.handle('toggle-config', async (event, id, enabled) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === id);
  
  if (!config) return configs;
  
  // 如果要启动监控，先测试 FTP 连接
  if (enabled) {
    const testResult = await testFTPConnection({
      host: config.host,
      port: config.port || 21,
      username: config.username,
      password: config.password,
      secure: config.secure || false
    });
    
    if (!testResult.success) {
      // 连接失败，不启动监控
      sendLog(id, `✗ 无法启动监控 Cannot Start Monitor | 原因 Reason: ${testResult.message}`, 'error');
      return configs;
    }
  }
  
  config.enabled = enabled;
  saveConfigs(configs);
  
  if (enabled) {
    await startWatcher(config);
  } else {
    stopWatcher(id);
  }
  
  return configs;
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  return result.canceled ? null : result.filePaths[0];
});

// 测试 FTP 连接的独立函数
async function testFTPConnection(config) {
  const client = new Client();
  client.ftp.timeout = 10000;
  client.ftp.verbose = false; // 关闭详细日志避免控制台污染
  
  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false } // 允许自签名证书
    });
    
    // 测试列出目录
    await client.list();
    
    await client.close();
    return { success: true, message: '连接成功！FTP服务器响应正常。' };
  } catch (error) {
    try {
      await client.close();
    } catch (e) {
      // 忽略关闭错误
    }
    
    // 提供更详细的错误信息
    let errorMsg = error.message;
    if (error.message.includes('530')) {
      errorMsg = '登录失败：用户名或密码错误。请检查FTP凭据是否正确。';
    } else if (error.message.includes('ECONNREFUSED')) {
      errorMsg = '连接被拒绝：无法连接到FTP服务器。请检查主机地址和端口是否正确。';
    } else if (error.message.includes('ETIMEDOUT')) {
      errorMsg = '连接超时：FTP服务器无响应。请检查网络连接和防火墙设置。';
    } else if (error.message.includes('ENOTFOUND')) {
      errorMsg = '主机未找到：无法解析FTP服务器地址。请检查主机名是否正确。';
    }
    
    return { success: false, message: errorMsg };
  }
}

ipcMain.handle('test-ftp-connection', async (event, config) => {
  return await testFTPConnection(config);
});

async function startWatcher(config) {
  if (watchers.has(config.id)) {
    watchers.get(config.id).close();
  }
  
  sendLog(config.id, `启动监控 Starting Monitor | 目录 Path: ${config.localPath}`, 'info');
  
  const watcher = chokidar.watch(config.localPath, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  });
  
  watcher
    .on('change', async (filePath) => {
      await uploadFile(config, filePath, 'modified');
    })
    .on('add', async (filePath) => {
      if (config.uploadNew) {
        await uploadFile(config, filePath, 'added');
      }
    })
    .on('error', (error) => {
      sendLog(config.id, `✗ 监控错误 Watcher Error | 详情 Details: ${error.message}`, 'error');
    });
  
  watchers.set(config.id, watcher);
  sendLog(config.id, '✓ 监控已启动 Monitor Started | 状态 Status: Running', 'success');
}

function stopWatcher(id) {
  if (watchers.has(id)) {
    watchers.get(id).close();
    watchers.delete(id);
    sendLog(id, '监控已停止 Monitor Stopped | 状态 Status: Inactive', 'info');
  }
  
  // 清理该配置的重试队列和上传锁
  for (const [key, value] of uploadQueue.entries()) {
    if (value.config.id === id) {
      uploadQueue.delete(key);
    }
  }
  
  // 清理该配置的所有上传锁
  for (const [key] of uploadLocks.entries()) {
    if (key.startsWith(`${id}:`)) {
      uploadLocks.delete(key);
    }
  }
}

async function uploadFile(config, filePath, action, retryCount = 0) {
  // 生成锁键
  const lockKey = `${config.id}:${filePath}`;
  
  // 检查是否已经在上传中
  if (uploadLocks.has(lockKey)) {
    sendLog(config.id, `⏳ 文件正在上传中，跳过重复请求 File Upload In Progress, Skipping | 文件 File: ${path.basename(filePath)}`, 'info');
    return;
  }
  
  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    sendLog(config.id, `⚠ 文件不存在，跳过上传 File Not Found, Skipping | 文件 File: ${filePath}`, 'error');
    // 从重试队列中移除
    const queueKey = `${config.id}:${filePath}`;
    uploadQueue.delete(queueKey);
    return;
  }
  
  // 设置上传锁
  uploadLocks.set(lockKey, true);
  
  // 使用 path.posix 明确处理 FTP 路径，避免 Windows 路径问题
  const relativePathRaw = path.relative(config.localPath, filePath);
  const relativePath = relativePathRaw.split(path.sep).join('/');
  const remotePath = path.posix.join(config.remotePath || '/', relativePath);
  
  const actionText = action === 'modified' ? '文件修改 Modified' : '新文件 New File';
  sendLog(config.id, `开始上传 Uploading | ${actionText} | 文件 File: ${relativePath}`, 'info');
  
  // 每次上传都创建新的 FTP 客户端，避免并发冲突
  const client = new Client();
  client.ftp.timeout = 30000;
  
  try {
    const startTime = Date.now();
    
    // 连接到 FTP 服务器
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false } // 允许自签名证书
    });
    
    // Ensure remote directory exists
    const remoteDir = path.posix.dirname(remotePath);
    await client.ensureDir(remoteDir);
    
    // Upload file
    await client.uploadFrom(filePath, remotePath);
    
    const fileSize = fs.statSync(filePath).size;
    const fileSizeKB = (fileSize / 1024).toFixed(2);
    const fileSizeMB = fileSize > 1024 * 1024 ? ` (${(fileSize / 1024 / 1024).toFixed(2)} MB)` : '';
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    sendLog(config.id, `✓ 上传成功 Upload Success | 文件 File: ${relativePath} | 大小 Size: ${fileSizeKB} KB${fileSizeMB} | 耗时 Duration: ${duration}s | 目标 Target: ${remotePath}`, 'success');
    
    // 清除重试队列中的该文件
    const queueKey = `${config.id}:${filePath}`;
    if (uploadQueue.has(queueKey)) {
      uploadQueue.delete(queueKey);
    }
    
    // 关闭 FTP 连接
    await client.close();
  } catch (error) {
    // 关闭失败的连接
    try {
      await client.close();
    } catch (e) {
      // 忽略关闭错误
    }
    
    // 实现重试机制
    if (retryCount < MAX_RETRIES) {
      const nextRetry = retryCount + 1;
      sendLog(config.id, `⚠ 上传失败，准备重试 Upload Failed, Retrying | 文件 File: ${relativePath} | 重试次数 Retry: ${nextRetry}/${MAX_RETRIES} | 错误 Error: ${error.message}`, 'error');
      
      // 延迟重试（指数退避）
      const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
      setTimeout(() => {
        uploadFile(config, filePath, action, nextRetry);
      }, delay);
      
      // 添加到重试队列
      const queueKey = `${config.id}:${filePath}`;
      uploadQueue.set(queueKey, { config, filePath, action, retryCount: nextRetry });
    } else {
      sendLog(config.id, `✗ 上传失败（已达最大重试次数） Upload Failed (Max Retries Reached) | 文件 File: ${relativePath} | 错误 Error: ${error.message}`, 'error');
      
      // 从重试队列中移除
      const queueKey = `${config.id}:${filePath}`;
      uploadQueue.delete(queueKey);
    }
  } finally {
    // 无论成功或失败，都释放上传锁
    uploadLocks.delete(lockKey);
  }
}

function sendLog(configId, message, type) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', {
      configId,
      message,
      type,
      timestamp: new Date().toISOString()
    });
  }
}

// Auto-start enabled watchers on app start
app.on('ready', () => {
  setTimeout(() => {
    const configs = loadConfigs();
    configs.forEach(config => {
      if (config.enabled) {
        startWatcher(config);
      }
    });
  }, 1000);
});
