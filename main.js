const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const chokidar = require('chokidar');
const { Client } = require('basic-ftp');
const fs = require('fs');
const archiver = require('archiver');
const extractZip = require('extract-zip');
const tar = require('tar');

// 配置文件路径 - 使用 userData 目录确保打包后可写
// 开发环境：项目根目录；生产环境：用户数据目录
const configPath = app.isPackaged
  ? path.join(app.getPath('userData'), 'ftp-configs.json')
  : path.join(__dirname, 'ftp-configs.json');

// 设置文件路径 - 用于保存用户偏好设置（如上次下载路径）
const settingsPath = app.isPackaged
  ? path.join(app.getPath('userData'), 'ftp-settings.json')
  : path.join(__dirname, 'ftp-settings.json');

const watchers = new Map();
const ftpClients = new Map();
const uploadQueue = new Map(); // 上传失败重试队列
const uploadLocks = new Map(); // 上传锁，防止并发上传同一文件
const uploadDebounce = new Map(); // 防抖定时器
const pendingUploads = new Map(); // 待上传队列（防抖后）
const connectionPool = new Map(); // FTP 连接池
const MAX_RETRIES = 3; // 最大重试次数
const DEBOUNCE_DELAY = 1000; // 防抖延迟（毫秒）- 增加到1秒以应对批量更新
const CONNECTION_TIMEOUT = 60000; // 连接超时时间
const MAX_POOL_SIZE = 3; // 每个配置最大连接数
const MAX_CONCURRENT_UPLOADS = 3; // 最大同时上传数量

// 并发控制队列
const activeUploads = new Map(); // 每个配置正在进行的上传数量
const pendingUploadQueue = new Map(); // 每个配置的待上传队列
const uploadStarted = new Map(); // 追踪每个配置是否有上传任务开始过

// 获取或创建 FTP 连接（连接池）
async function getPooledConnection(config) {
  const poolKey = config.id;

  if (!connectionPool.has(poolKey)) {
    connectionPool.set(poolKey, []);
  }

  const pool = connectionPool.get(poolKey);

  // 尝试获取空闲连接
  for (let i = 0; i < pool.length; i++) {
    const conn = pool[i];
    if (!conn.inUse && conn.client.closed === false) {
      try {
        // 测试连接是否还有效
        await conn.client.pwd();
        conn.inUse = true;
        conn.lastUsed = Date.now();
        return conn;
      } catch (e) {
        // 连接已失效，移除
        pool.splice(i, 1);
        i--;
      }
    }
  }

  // 创建新连接
  if (pool.length < MAX_POOL_SIZE) {
    const client = new Client();
    client.ftp.timeout = CONNECTION_TIMEOUT;

    try {
      await client.access({
        host: config.host,
        port: config.port || 21,
        user: config.username,
        password: config.password,
        secure: config.secure || false,
        secureOptions: { rejectUnauthorized: false }
      });

      const conn = {
        client,
        inUse: true,
        lastUsed: Date.now()
      };

      pool.push(conn);
      return conn;
    } catch (error) {
      throw error;
    }
  }

  // 等待空闲连接
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      for (const conn of pool) {
        if (!conn.inUse) {
          conn.inUse = true;
          conn.lastUsed = Date.now();
          clearInterval(checkInterval);
          resolve(conn);
          return;
        }
      }
    }, 100);

    // 超时
    setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error('获取连接超时'));
    }, 10000);
  });
}

// 释放连接回连接池
function releaseConnection(configId, conn) {
  if (conn) {
    conn.inUse = false;
    conn.lastUsed = Date.now();
  }
}

// 清理配置的所有连接
async function clearConnectionPool(configId) {
  const pool = connectionPool.get(configId);
  if (pool) {
    for (const conn of pool) {
      try {
        await conn.client.close();
      } catch (e) { }
    }
    connectionPool.delete(configId);
  }
}

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
  } else {
    // Windows/Linux 使用无边框窗口
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile('index.html');

  // 监听窗口最大化状态变化（用于更新 Windows 窗口控制按钮图标）
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximized', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-maximized', false);
  });

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

app.on('window-all-closed', async () => {
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

  // 清理所有连接池
  for (const [configId] of connectionPool.entries()) {
    await clearConnectionPool(configId);
  }

  // 关闭应用时，将所有配置的 enabled 状态设为 false
  const configs = loadConfigs();
  configs.forEach(config => {
    config.enabled = false;
  });
  saveConfigs(configs);

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS 应用退出前也要重置状态
app.on('before-quit', () => {
  // 停止所有监控
  watchers.forEach(watcher => {
    try {
      watcher.close();
    } catch (error) { }
  });
  watchers.clear();

  // 重置所有配置的 enabled 状态
  const configs = loadConfigs();
  configs.forEach(config => {
    config.enabled = false;
  });
  saveConfigs(configs);
});

// IPC Handlers

// 获取平台信息
ipcMain.handle('get-platform', () => {
  return process.platform;
});

// 窗口控制
ipcMain.on('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

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

ipcMain.handle('select-directory', async (event, defaultPath) => {
  const options = {
    properties: ['openDirectory']
  };

  // 如果提供了默认路径，设置为默认打开目录
  if (defaultPath && fs.existsSync(defaultPath)) {
    options.defaultPath = defaultPath;
  }

  const result = await dialog.showOpenDialog(mainWindow, options);

  return result.canceled ? null : result.filePaths[0];
});

// 选择多个文件夹
ipcMain.handle('select-multiple-directories', async (event, defaultPath) => {
  const options = {
    properties: ['openDirectory', 'multiSelections']
  };

  // 如果提供了默认路径，设置为默认打开目录
  if (defaultPath && fs.existsSync(defaultPath)) {
    options.defaultPath = defaultPath;
  }

  const result = await dialog.showOpenDialog(mainWindow, options);

  return result.canceled ? [] : result.filePaths;
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

  // 构建排除规则
  const excludeFolders = config.excludeFolders || [];
  const excludeInfo = excludeFolders.length > 0 ? `排除 Exclude: ${excludeFolders.join(', ')}` : '无排除 No Exclusions';
  sendLog(config.id, `启动监控 Starting Monitor | 目录 Path: ${config.localPath} | ${excludeInfo}`, 'info');

  // 构建 ignored 规则
  const ignoredPatterns = [
    /(^|[\/\\])\../, // ignore dotfiles
  ];

  // 添加用户自定义的排除文件夹
  excludeFolders.forEach(folder => {
    // 支持相对路径匹配
    const escapedFolder = folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 匹配文件夹本身及其内容
    ignoredPatterns.push(new RegExp(`(^|[/\\\\])${escapedFolder}([/\\\\]|$)`));
  });

  // 构建 chokidar 配置
  // 在 Windows 上使用轮询模式以确保兼容性
  const isWindows = process.platform === 'win32';
  const watcherOptions = {
    ignored: ignoredPatterns,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: isWindows ? 3000 : 2000, // Windows 上稍长的稳定时间
      pollInterval: 100
    },
    // Windows 特定配置：使用轮询模式确保兼容性
    usePolling: isWindows,
    interval: isWindows ? 300 : undefined, // 轮询间隔（毫秒）
    binaryInterval: isWindows ? 300 : undefined
  };

  const watcher = chokidar.watch(config.localPath, watcherOptions);

  watcher
    .on('change', (filePath) => {
      // 使用防抖机制，避免同一文件短时间内多次触发上传
      debouncedUpload(config, filePath, 'modified');
    })
    .on('add', (filePath) => {
      if (config.uploadNew) {
        // 新文件也使用防抖，避免文件还在写入时就开始上传
        debouncedUpload(config, filePath, 'added');
      }
    })
    .on('error', (error) => {
      sendLog(config.id, `✗ 监控错误 Watcher Error | 详情 Details: ${error.message}`, 'error');
    });

  watchers.set(config.id, watcher);
  sendLog(config.id, '✓ 监控已启动 Monitor Started | 状态 Status: Running', 'success');
}

// 防抖上传函数
function debouncedUpload(config, filePath, action) {
  const debounceKey = `${config.id}:${filePath}`;

  // 清除之前的定时器
  if (uploadDebounce.has(debounceKey)) {
    clearTimeout(uploadDebounce.get(debounceKey));
  }

  // 设置新的定时器
  const timer = setTimeout(async () => {
    uploadDebounce.delete(debounceKey);

    // 检查监控是否还在运行
    if (!watchers.has(config.id)) {
      return;
    }

    // 检查文件是否存在且稳定
    if (!fs.existsSync(filePath)) {
      return;
    }

    // 再次检查文件是否还在被写入
    try {
      const stats1 = fs.statSync(filePath);
      await new Promise(resolve => setTimeout(resolve, 100));
      const stats2 = fs.statSync(filePath);

      // 如果文件大小还在变化，等待下一次触发
      if (stats1.size !== stats2.size) {
        sendLog(config.id, `⏳ 文件仍在写入中 File Still Writing | 文件 File: ${path.basename(filePath)}`, 'info');
        return;
      }
    } catch (e) {
      // 文件可能已被删除
      return;
    }

    // 添加到上传队列而不是直接上传
    enqueueUpload(config, filePath, action);
  }, DEBOUNCE_DELAY);

  uploadDebounce.set(debounceKey, timer);
}

// 将文件添加到上传队列
function enqueueUpload(config, filePath, action) {
  const configId = config.id;

  // 初始化该配置的队列
  if (!pendingUploadQueue.has(configId)) {
    pendingUploadQueue.set(configId, []);
  }
  if (!activeUploads.has(configId)) {
    activeUploads.set(configId, 0);
  }

  const queue = pendingUploadQueue.get(configId);

  // 检查是否已在队列中（避免重复添加）
  const existingIndex = queue.findIndex(item => item.filePath === filePath);
  if (existingIndex !== -1) {
    // 更新已存在的项目
    queue[existingIndex] = { config, filePath, action };
  } else {
    // 添加到队列
    queue.push({ config, filePath, action });
  }

  // 显示队列状态
  const activeCount = activeUploads.get(configId);
  const pendingCount = queue.length;
  if (pendingCount > 1) {
    sendLog(configId, `📋 加入上传队列 Queued for Upload | 文件 File: ${path.basename(filePath)} | 等待中 Pending: ${pendingCount} | 上传中 Uploading: ${activeCount}`, 'info');
  }

  // 尝试处理队列
  processUploadQueue(configId);
}

// 处理上传队列
async function processUploadQueue(configId) {
  if (!pendingUploadQueue.has(configId)) return;
  if (!activeUploads.has(configId)) {
    activeUploads.set(configId, 0);
  }

  const queue = pendingUploadQueue.get(configId);
  const currentActive = activeUploads.get(configId);

  // 检查是否可以开始新的上传
  while (queue.length > 0 && activeUploads.get(configId) < MAX_CONCURRENT_UPLOADS) {
    // 检查监控是否还在运行
    if (!watchers.has(configId)) {
      // 清空队列
      queue.length = 0;
      activeUploads.set(configId, 0);
      uploadStarted.delete(configId);
      return;
    }

    const item = queue.shift();
    if (!item) continue;

    // 标记有上传任务开始
    uploadStarted.set(configId, true);

    // 增加活跃上传计数
    activeUploads.set(configId, activeUploads.get(configId) + 1);

    // 异步执行上传（不等待完成，允许并行）
    executeUpload(item.config, item.filePath, item.action).finally(() => {
      // 上传完成后减少计数并尝试处理下一个
      activeUploads.set(configId, Math.max(0, activeUploads.get(configId) - 1));

      // 检查是否所有上传都已完成
      const remainingActive = activeUploads.get(configId);
      const remainingQueue = pendingUploadQueue.get(configId)?.length || 0;

      if (remainingActive === 0 && remainingQueue === 0 && uploadStarted.get(configId)) {
        // 所有上传任务完成，播放提示音
        uploadStarted.delete(configId);
        playUploadCompleteSound();
      }

      processUploadQueue(configId);
    });
  }
}

// 执行实际上传（包装 uploadFile）
async function executeUpload(config, filePath, action) {
  try {
    await uploadFile(config, filePath, action);
  } catch (error) {
    sendLog(config.id, `✗ 上传执行错误 Upload Execution Error | 文件 File: ${path.basename(filePath)} | 错误 Error: ${error.message}`, 'error');
  }
}

async function stopWatcher(id) {
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

  // 清理该配置的所有防抖定时器
  for (const [key, timer] of uploadDebounce.entries()) {
    if (key.startsWith(`${id}:`)) {
      clearTimeout(timer);
      uploadDebounce.delete(key);
    }
  }

  // 清理上传队列和活跃计数
  if (pendingUploadQueue.has(id)) {
    const queue = pendingUploadQueue.get(id);
    if (queue.length > 0) {
      sendLog(id, `清理上传队列 Clearing Upload Queue | 待处理 Pending: ${queue.length}`, 'info');
    }
    pendingUploadQueue.delete(id);
  }
  activeUploads.delete(id);

  // 清理连接池
  await clearConnectionPool(id);
}

async function uploadFile(config, filePath, action, retryCount = 0) {
  // 检查监控是否还在运行（停止监控后不应继续上传）
  if (!watchers.has(config.id)) {
    sendLog(config.id, `⏸ 监控已停止，取消上传 Monitor Stopped, Upload Cancelled | 文件 File: ${path.basename(filePath)}`, 'info');
    return;
  }

  // 检查是否在排除文件夹中（双重检查，防止运行时添加的排除规则未生效）
  const excludeFolders = config.excludeFolders || [];
  if (excludeFolders.length > 0) {
    const relativePath = path.relative(config.localPath, filePath);
    const relativePathNormalized = relativePath.split(path.sep).join('/');

    for (const folder of excludeFolders) {
      // 检查相对路径是否以排除文件夹开头，或者包含该文件夹
      if (relativePathNormalized === folder ||
        relativePathNormalized.startsWith(folder + '/') ||
        relativePathNormalized.includes('/' + folder + '/') ||
        relativePathNormalized.includes('/' + folder)) {
        sendLog(config.id, `⏭ 跳过排除文件夹 Skipping Excluded | 文件 File: ${relativePath} | 排除规则 Exclude: ${folder}`, 'info');
        return;
      }
    }
  }

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
  const fileName = path.basename(filePath);

  const actionText = action === 'modified' ? '文件修改 Modified' : '新文件 New File';
  sendLog(config.id, `开始上传 Uploading | ${actionText} | 文件 File: ${relativePath}`, 'info');

  // 获取文件大小
  let fileSize = 0;
  try {
    fileSize = fs.statSync(filePath).size;
  } catch (e) {
    // 文件可能已被删除
  }

  // 再次检查监控状态（上传前最后确认）
  if (!watchers.has(config.id)) {
    sendLog(config.id, `⏸ 监控已停止，取消上传 Monitor Stopped, Upload Cancelled | 文件 File: ${path.basename(filePath)}`, 'info');
    uploadLocks.delete(lockKey);
    return;
  }

  // 通知渲染进程添加传输任务
  let taskId = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    taskId = Date.now() + Math.random();
    mainWindow.webContents.send('add-transfer-task', {
      type: 'upload',
      fileName,
      filePath: relativePath,
      taskId
    });
  }

  // 每次上传都创建新的 FTP 客户端，避免并发冲突
  const client = new Client();
  client.ftp.timeout = 30000;
  client.ftp.socket.setKeepAlive(true); // 保持连接活跃

  try {
    const startTime = Date.now();
    let lastBytes = 0;
    let lastTime = startTime;

    // 连接到 FTP 服务器（使用被动模式）
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false } // 允许自签名证书
    });

    // 使用被动模式（更好的 NAT/防火墙兼容性）
    client.ftp.verbose = false;

    // 设置进度跟踪
    if (fileSize > 0 && taskId) {
      client.trackProgress(info => {
        const progress = Math.round((info.bytes / fileSize) * 100);
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;

        if (timeDiff >= 0.5) { // 每 0.5 秒更新一次
          const bytesDiff = info.bytes - lastBytes;
          const speed = bytesDiff / timeDiff;
          const speedText = formatBytes(speed) + '/s';

          sendTransferProgress(taskId, progress, speedText);

          lastBytes = info.bytes;
          lastTime = now;
        }
      });
    }

    // Ensure remote directory exists
    const remoteDir = path.posix.dirname(remotePath);
    await client.ensureDir(remoteDir);

    // Upload file
    await client.uploadFrom(filePath, remotePath);

    // 停止进度跟踪
    client.trackProgress();

    const fileSizeKB = (fileSize / 1024).toFixed(2);
    const fileSizeMB = fileSize > 1024 * 1024 ? ` (${(fileSize / 1024 / 1024).toFixed(2)} MB)` : '';
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    sendLog(config.id, `✓ 上传成功 Upload Success | 文件 File: ${relativePath} | 大小 Size: ${fileSizeKB} KB${fileSizeMB} | 耗时 Duration: ${duration}s | 目标 Target: ${remotePath}`, 'success');

    // 通知传输完成
    if (taskId) {
      sendTransferComplete(taskId, true);
    }

    // 清除重试队列中的该文件
    const queueKey = `${config.id}:${filePath}`;
    if (uploadQueue.has(queueKey)) {
      uploadQueue.delete(queueKey);
    }

    // 关闭 FTP 连接
    await client.close();
  } catch (error) {
    // 停止进度跟踪
    try {
      client.trackProgress();
    } catch (e) { }

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

      // 添加到重试队列
      const queueKey = `${config.id}:${filePath}`;
      uploadQueue.set(queueKey, { config, filePath, action, retryCount: nextRetry });

      // 先释放锁，再延迟重试
      uploadLocks.delete(lockKey);

      // 延迟重试（指数退避）
      const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
      setTimeout(async () => {
        // 重试前检查监控是否还在运行
        if (!watchers.has(config.id)) {
          uploadQueue.delete(queueKey);
          if (taskId) sendTransferComplete(taskId, false, '监控已停止');
          return;
        }
        await uploadFile(config, filePath, action, nextRetry);
      }, delay);

      return; // 提前返回，不执行 finally 中的锁释放
    } else {
      sendLog(config.id, `✗ 上传失败（已达最大重试次数） Upload Failed (Max Retries Reached) | 文件 File: ${relativePath} | 错误 Error: ${error.message}`, 'error');

      // 通知传输失败
      if (taskId) {
        sendTransferComplete(taskId, false, error.message);
      }

      // 从重试队列中移除
      const queueKey = `${config.id}:${filePath}`;
      uploadQueue.delete(queueKey);
    }
  } finally {
    // 只有非重试情况才在这里释放锁
    if (uploadLocks.has(lockKey)) {
      uploadLocks.delete(lockKey);
    }
  }
}

// 格式化字节数
function formatBytes(bytes) {
  if (bytes < 1024) {
    return bytes.toFixed(0) + ' B';
  } else if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  } else {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
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

// 发送传输进度更新
function sendTransferProgress(taskId, progress, speed) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('transfer-progress', { taskId, progress, speed });
  }
}

// 发送传输完成通知
function sendTransferComplete(taskId, success, error = null) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('transfer-complete', { taskId, success, error });
  }
}

// 发送添加传输任务请求
function sendAddTransferTask(type, fileName, filePath) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('add-transfer-task', { type, fileName, filePath });
  }
}

// 播放上传完成提示音
function playUploadCompleteSound() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('play-upload-complete-sound');
  }
}

// ==================== FTP 文件管理 IPC ====================

// 列出远程目录
ipcMain.handle('ftp-list-dir', async (event, { configId, remotePath }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 15000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    const list = await client.list(remotePath || '/');
    await client.close();

    const files = list.map(item => {
      // 格式化权限为数字格式（如 755）
      let permStr = '';
      if (item.permissions) {
        const calcPerm = (p) => {
          if (!p) return 0;
          return (p.read ? 4 : 0) + (p.write ? 2 : 0) + (p.execute ? 1 : 0);
        };
        permStr = '' + calcPerm(item.permissions.user) +
          calcPerm(item.permissions.group) +
          calcPerm(item.permissions.world);
      }

      return {
        name: item.name,
        type: item.isDirectory ? 'directory' : 'file',
        size: item.size,
        modifiedAt: item.modifiedAt ? item.modifiedAt.toISOString() : null,
        rawModifiedAt: item.rawModifiedAt || null,
        path: path.posix.join(remotePath || '/', item.name),
        permissions: permStr || null,
        owner: item.user || null,
        group: item.group || null,
        isSymbolicLink: item.isSymbolicLink || false,
        link: item.link || null
      };
    });

    // 排序：文件夹在前，文件在后，按名称排序
    files.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return { success: true, files };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    return { success: false, error: error.message };
  }
});

// 读取远程文件内容
ipcMain.handle('ftp-read-file', async (event, { configId, remotePath }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 30000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 下载到临时文件
    const tempDir = app.getPath('temp');
    const tempFile = path.join(tempDir, `ftp-edit-${Date.now()}-${path.basename(remotePath)}`);

    await client.downloadTo(tempFile, remotePath);
    await client.close();

    // 读取文件内容
    const stats = fs.statSync(tempFile);

    // 限制文件大小（1MB）
    if (stats.size > 1024 * 1024) {
      fs.unlinkSync(tempFile);
      return { success: false, error: '文件过大（超过1MB），不支持在线编辑' };
    }

    // 读取文件内容
    const buffer = fs.readFileSync(tempFile);

    // 检测是否为二进制文件（检查是否包含 NULL 字节）
    let isBinary = false;
    for (let i = 0; i < Math.min(buffer.length, 8000); i++) {
      if (buffer[i] === 0) {
        isBinary = true;
        break;
      }
    }

    let content;
    if (isBinary) {
      // 二进制文件显示十六进制预览
      const hexLines = [];
      const bytesPerLine = 16;
      const maxLines = 100; // 最多显示 100 行

      for (let i = 0; i < Math.min(buffer.length, bytesPerLine * maxLines); i += bytesPerLine) {
        const offset = i.toString(16).padStart(8, '0');
        const bytes = [];
        const chars = [];

        for (let j = 0; j < bytesPerLine; j++) {
          if (i + j < buffer.length) {
            const byte = buffer[i + j];
            bytes.push(byte.toString(16).padStart(2, '0'));
            // 可打印字符显示原字符，否则显示点
            chars.push(byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.');
          } else {
            bytes.push('  ');
            chars.push(' ');
          }
        }

        hexLines.push(`${offset}  ${bytes.slice(0, 8).join(' ')}  ${bytes.slice(8).join(' ')}  |${chars.join('')}|`);
      }

      const header = `// 二进制文件预览 (只读)\n// 文件大小: ${stats.size} 字节\n// 显示前 ${Math.min(buffer.length, bytesPerLine * maxLines)} 字节\n// 如需编辑，请下载后使用专业工具\n\n`;
      content = header + hexLines.join('\n');

      if (buffer.length > bytesPerLine * maxLines) {
        content += `\n\n// ... 还有 ${buffer.length - bytesPerLine * maxLines} 字节未显示`;
      }
    } else {
      content = buffer.toString('utf8');
    }

    fs.unlinkSync(tempFile);

    return { success: true, content, isBinary };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    return { success: false, error: error.message };
  }
});

// 下载图片用于预览
ipcMain.handle('ftp-download-image', async (event, { configId, remotePath }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 30000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 下载到临时文件
    const tempDir = app.getPath('temp');
    const ext = path.extname(remotePath) || '.tmp';
    const tempFile = path.join(tempDir, `ftp-image-${Date.now()}${ext}`);

    await client.downloadTo(tempFile, remotePath);
    await client.close();

    return { success: true, tempPath: tempFile };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    return { success: false, error: error.message };
  }
});

// 修改文件权限
ipcMain.handle('ftp-chmod', async (event, { configId, remotePath, permissions }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 15000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 发送 SITE CHMOD 命令
    await client.send(`SITE CHMOD ${permissions} ${remotePath}`);
    await client.close();

    return { success: true };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    return { success: false, error: error.message };
  }
});

// 保存远程文件内容
ipcMain.handle('ftp-save-file', async (event, { configId, remotePath, content }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 30000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 写入临时文件
    const tempDir = app.getPath('temp');
    const tempFile = path.join(tempDir, `ftp-save-${Date.now()}-${path.basename(remotePath)}`);
    fs.writeFileSync(tempFile, content, 'utf8');

    // 上传
    await client.uploadFrom(tempFile, remotePath);
    await client.close();

    // 清理临时文件
    fs.unlinkSync(tempFile);

    sendLog(configId, `✓ 文件保存成功 File Saved | 路径 Path: ${remotePath}`, 'success');
    return { success: true };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    sendLog(configId, `✗ 文件保存失败 Save Failed | 路径 Path: ${remotePath} | 错误 Error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
});

// 删除远程文件或目录
ipcMain.handle('ftp-delete', async (event, { configId, remotePath, isDir }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 30000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    if (isDir) {
      await client.removeDir(remotePath);
    } else {
      await client.remove(remotePath);
    }

    await client.close();

    sendLog(configId, `✓ 删除成功 Deleted | 路径 Path: ${remotePath}`, 'success');
    return { success: true };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    sendLog(configId, `✗ 删除失败 Delete Failed | 路径 Path: ${remotePath} | 错误 Error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
});

// 创建远程目录
ipcMain.handle('ftp-create-dir', async (event, { configId, remotePath }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 15000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    await client.ensureDir(remotePath);
    await client.close();

    sendLog(configId, `✓ 目录创建成功 Directory Created | 路径 Path: ${remotePath}`, 'success');
    return { success: true };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    sendLog(configId, `✗ 目录创建失败 Create Failed | 路径 Path: ${remotePath} | 错误 Error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
});

// 创建远程文件
ipcMain.handle('ftp-create-file', async (event, { configId, remotePath, content }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 15000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 确保父目录存在
    const parentDir = path.posix.dirname(remotePath);
    await client.ensureDir(parentDir);

    // 创建临时文件
    const tempPath = path.join(app.getPath('temp'), `ftp-new-file-${Date.now()}.tmp`);
    fs.writeFileSync(tempPath, content || '', 'utf8');

    // 上传文件
    await client.uploadFrom(tempPath, remotePath);

    // 删除临时文件
    fs.unlinkSync(tempPath);

    await client.close();

    sendLog(configId, `✓ 文件创建成功 File Created | 路径 Path: ${remotePath}`, 'success');
    return { success: true };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    sendLog(configId, `✗ 文件创建失败 Create Failed | 路径 Path: ${remotePath} | 错误 Error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
});

// 复制远程文件或目录
ipcMain.handle('ftp-copy', async (event, { configId, sourcePath, targetPath, isDir }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 60000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // FTP 协议不支持直接复制，需要下载再上传
    const tempDir = path.join(app.getPath('temp'), `ftp-copy-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    if (isDir) {
      // 复制文件夹
      const tempLocalPath = path.join(tempDir, path.posix.basename(sourcePath));
      await client.downloadToDir(tempLocalPath, sourcePath);

      // 确保目标目录存在
      await client.ensureDir(path.posix.dirname(targetPath));
      await client.uploadFromDir(tempLocalPath, targetPath);

      // 清理临时文件
      fs.rmSync(tempDir, { recursive: true, force: true });
    } else {
      // 复制文件
      const tempLocalPath = path.join(tempDir, path.posix.basename(sourcePath));
      await client.downloadTo(tempLocalPath, sourcePath);

      // 确保目标目录存在
      await client.ensureDir(path.posix.dirname(targetPath));
      await client.uploadFrom(tempLocalPath, targetPath);

      // 清理临时文件
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    await client.close();

    sendLog(configId, `✓ 复制成功 Copy Success | 源 Source: ${sourcePath} | 目标 Target: ${targetPath}`, 'success');
    return { success: true };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    sendLog(configId, `✗ 复制失败 Copy Failed | 源 Source: ${sourcePath} | 错误 Error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
});

// 重命名远程文件或目录
ipcMain.handle('ftp-rename', async (event, { configId, oldPath, newPath }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 15000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    await client.rename(oldPath, newPath);
    await client.close();

    sendLog(configId, `✓ 重命名成功 Renamed | ${oldPath} -> ${newPath}`, 'success');
    return { success: true };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    sendLog(configId, `✗ 重命名失败 Rename Failed | 错误 Error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
});

// 上传文件
ipcMain.handle('ftp-upload', async (event, { configId, localPath, remotePath, taskId }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 60000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 确保目录存在
    const remoteDir = path.posix.dirname(remotePath);
    await client.ensureDir(remoteDir);

    // 获取文件大小用于计算进度
    const fileSize = fs.statSync(localPath).size;
    let lastBytes = 0;
    let lastTime = Date.now();

    // 设置进度跟踪
    if (taskId) {
      client.trackProgress(info => {
        if (info.type === 'upload' && fileSize > 0) {
          const progress = Math.round((info.bytes / fileSize) * 100);

          // 计算速度
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000; // 秒
          const bytesDiff = info.bytes - lastBytes;
          let speed = '';

          if (timeDiff > 0.5) { // 每0.5秒更新一次速度
            const bytesPerSec = bytesDiff / timeDiff;
            if (bytesPerSec >= 1024 * 1024) {
              speed = `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
            } else if (bytesPerSec >= 1024) {
              speed = `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
            } else {
              speed = `${Math.round(bytesPerSec)} B/s`;
            }
            lastBytes = info.bytes;
            lastTime = now;
          }

          sendTransferProgress(taskId, progress, speed);
        }
      });
    }

    // 上传文件
    await client.uploadFrom(localPath, remotePath);

    // 停止进度跟踪
    client.trackProgress();

    await client.close();

    const fileSizeKB = (fileSize / 1024).toFixed(2);
    sendLog(configId, `✓ 上传成功 Upload Success | 文件 File: ${path.basename(localPath)} | 大小 Size: ${fileSizeKB} KB | 目标 Target: ${remotePath}`, 'success');

    return { success: true };
  } catch (error) {
    client.trackProgress(); // 停止进度跟踪
    try { await client.close(); } catch (e) { }
    sendLog(configId, `✗ 上传失败 Upload Failed | 文件 File: ${path.basename(localPath)} | 错误 Error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
});


// 上传文件夹（递归）
ipcMain.handle('ftp-upload-dir', async (event, { configId, localPath, remotePath, taskId }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 120000;

  // 递归计算目录总大小
  function getDirSize(dirPath) {
    let totalSize = 0;
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stats = fs.statSync(itemPath);
      if (stats.isDirectory()) {
        totalSize += getDirSize(itemPath);
      } else {
        totalSize += stats.size;
      }
    }
    return totalSize;
  }

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 计算目录总大小
    const totalSize = getDirSize(localPath);
    let lastBytes = 0;
    let lastTime = Date.now();

    // 设置进度跟踪
    if (taskId && totalSize > 0) {
      client.trackProgress(info => {
        if (info.type === 'upload') {
          const progress = Math.round((info.bytesOverall / totalSize) * 100);

          // 计算速度
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000;
          const bytesDiff = info.bytesOverall - lastBytes;
          let speed = '';

          if (timeDiff > 0.5) {
            const bytesPerSec = bytesDiff / timeDiff;
            if (bytesPerSec >= 1024 * 1024) {
              speed = `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
            } else if (bytesPerSec >= 1024) {
              speed = `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
            } else {
              speed = `${Math.round(bytesPerSec)} B/s`;
            }
            lastBytes = info.bytesOverall;
            lastTime = now;
          }

          sendTransferProgress(taskId, Math.min(progress, 99), speed); // 最大99%，完成时设100%
        }
      });
    }

    // 递归上传目录
    await client.uploadFromDir(localPath, remotePath);

    // 停止进度跟踪
    client.trackProgress();

    await client.close();

    sendLog(configId, `✓ 文件夹上传成功 Folder Upload Success | 目录 Dir: ${path.basename(localPath)} | 目标 Target: ${remotePath}`, 'success');
    return { success: true };
  } catch (error) {
    client.trackProgress(); // 停止进度跟踪
    try { await client.close(); } catch (e) { }
    sendLog(configId, `✗ 文件夹上传失败 Folder Upload Failed | 目录 Dir: ${path.basename(localPath)} | 错误 Error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
});


// 下载文件
ipcMain.handle('ftp-download', async (event, { configId, remotePath, localPath, taskId }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 60000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 确保本地目录存在
    const localDir = path.dirname(localPath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    // 获取远程文件大小
    let fileSize = 0;
    try {
      fileSize = await client.size(remotePath);
    } catch (e) {
      // 如果无法获取大小，忽略，进度条将不显示
    }

    let lastBytes = 0;
    let lastTime = Date.now();

    // 设置进度跟踪
    if (taskId && fileSize > 0) {
      client.trackProgress(info => {
        if (info.type === 'download') {
          const progress = Math.round((info.bytes / fileSize) * 100);

          // 计算速度
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000;
          const bytesDiff = info.bytes - lastBytes;
          let speed = '';

          if (timeDiff > 0.5) {
            const bytesPerSec = bytesDiff / timeDiff;
            if (bytesPerSec >= 1024 * 1024) {
              speed = `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
            } else if (bytesPerSec >= 1024) {
              speed = `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
            } else {
              speed = `${Math.round(bytesPerSec)} B/s`;
            }
            lastBytes = info.bytes;
            lastTime = now;
          }

          sendTransferProgress(taskId, progress, speed);
        }
      });
    }

    await client.downloadTo(localPath, remotePath);

    // 停止进度跟踪
    client.trackProgress();

    await client.close();

    sendLog(configId, `✓ 下载成功 Download Success | 文件 File: ${path.basename(remotePath)} | 保存至 Saved to: ${localPath}`, 'success');
    playUploadCompleteSound(); // 播放完成提示音
    return { success: true };
  } catch (error) {
    client.trackProgress(); // 停止进度跟踪
    try { await client.close(); } catch (e) { }
    sendLog(configId, `✗ 下载失败 Download Failed | 文件 File: ${path.basename(remotePath)} | 错误 Error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
});


// 下载文件夹（递归）
ipcMain.handle('ftp-download-dir', async (event, { configId, remotePath, localPath, taskId }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 120000;

  // 递归计算远程目录总大小
  async function getRemoteDirSize(client, dirPath) {
    let totalSize = 0;
    try {
      const list = await client.list(dirPath);
      for (const item of list) {
        if (item.isDirectory) {
          totalSize += await getRemoteDirSize(client, path.posix.join(dirPath, item.name));
        } else {
          totalSize += item.size || 0;
        }
      }
    } catch (e) {
      // 忽略错误
    }
    return totalSize;
  }

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 确保本地目录存在
    if (!fs.existsSync(localPath)) {
      fs.mkdirSync(localPath, { recursive: true });
    }

    // 计算远程目录总大小
    let totalSize = 0;
    if (taskId) {
      totalSize = await getRemoteDirSize(client, remotePath);
    }

    let lastBytes = 0;
    let lastTime = Date.now();

    // 设置进度跟踪
    if (taskId && totalSize > 0) {
      client.trackProgress(info => {
        if (info.type === 'download') {
          const progress = Math.round((info.bytesOverall / totalSize) * 100);

          // 计算速度
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000;
          const bytesDiff = info.bytesOverall - lastBytes;
          let speed = '';

          if (timeDiff > 0.5) {
            const bytesPerSec = bytesDiff / timeDiff;
            if (bytesPerSec >= 1024 * 1024) {
              speed = `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
            } else if (bytesPerSec >= 1024) {
              speed = `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
            } else {
              speed = `${Math.round(bytesPerSec)} B/s`;
            }
            lastBytes = info.bytesOverall;
            lastTime = now;
          }

          sendTransferProgress(taskId, Math.min(progress, 99), speed);
        }
      });
    }

    await client.downloadToDir(localPath, remotePath);

    // 停止进度跟踪
    client.trackProgress();

    await client.close();

    sendLog(configId, `✓ 文件夹下载成功 Folder Download Success | 目录 Dir: ${path.basename(remotePath)} | 保存至 Saved to: ${localPath}`, 'success');
    playUploadCompleteSound(); // 播放完成提示音
    return { success: true };
  } catch (error) {
    client.trackProgress(); // 停止进度跟踪
    try { await client.close(); } catch (e) { }
    sendLog(configId, `✗ 文件夹下载失败 Folder Download Failed | 目录 Dir: ${path.basename(remotePath)} | 错误 Error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
});


// 读取设置
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('读取设置文件失败:', error);
  }
  return {};
}

// 保存设置
function saveSettings(settings) {
  try {
    const settingsDir = path.dirname(settingsPath);
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('保存设置文件失败:', error);
    return false;
  }
}

// 选择保存路径
ipcMain.handle('select-save-path', async (event, { defaultName, isDir }) => {
  // 获取上次保存的路径
  const settings = loadSettings();
  const lastSavePath = settings.lastSavePath || app.getPath('downloads');

  // 确保路径存在，不存在则使用下载目录
  const basePath = fs.existsSync(lastSavePath) ? lastSavePath : app.getPath('downloads');

  if (isDir) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择保存位置',
      defaultPath: basePath,
      properties: ['openDirectory', 'createDirectory']
    });

    // 保存选择的路径
    if (!result.canceled && result.filePaths[0]) {
      settings.lastSavePath = result.filePaths[0];
      saveSettings(settings);
    }

    return { canceled: result.canceled, path: result.filePaths[0] };
  } else {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存文件',
      defaultPath: path.join(basePath, defaultName),
      properties: ['createDirectory']
    });

    // 保存选择的路径（保存文件的父目录）
    if (!result.canceled && result.filePath) {
      settings.lastSavePath = path.dirname(result.filePath);
      saveSettings(settings);
    }

    return { canceled: result.canceled, path: result.filePath };
  }
});

// 选择上传文件
ipcMain.handle('select-upload-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择要上传的文件',
    properties: ['openFile', 'multiSelections']
  });
  return { canceled: result.canceled, paths: result.filePaths };
});

// 选择上传文件夹（支持多选）
ipcMain.handle('select-upload-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择要上传的文件夹',
    properties: ['openDirectory', 'multiSelections']
  });
  return { canceled: result.canceled, path: result.filePaths[0], paths: result.filePaths };
});

// 准备拖拽下载（先下载到临时目录，然后启动系统拖拽）
ipcMain.handle('prepare-drag-download', async (event, { configId, remotePath, fileName }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const client = new Client();
  client.ftp.timeout = 60000;

  try {
    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 下载到临时目录
    const tempDir = app.getPath('temp');
    const tempFile = path.join(tempDir, `ftp-drag-${Date.now()}-${fileName}`);

    await client.downloadTo(tempFile, remotePath);
    await client.close();

    return { success: true, tempPath: tempFile };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    return { success: false, error: error.message };
  }
});

// 启动系统拖拽
ipcMain.on('start-drag', (event, filePath) => {
  if (fs.existsSync(filePath)) {
    event.sender.startDrag({
      file: filePath,
      icon: path.join(__dirname, 'ftp.png') // 使用应用图标
    });
  }
});

// 取消传输任务（目前仅做标记，实际传输无法中断）
// 存储被取消的任务 ID
const cancelledTasks = new Set();

ipcMain.on('cancel-transfer', (event, taskId) => {
  cancelledTasks.add(taskId);
  // 5分钟后清理
  setTimeout(() => {
    cancelledTasks.delete(taskId);
  }, 5 * 60 * 1000);
});

// 检查任务是否被取消
function isTaskCancelled(taskId) {
  return cancelledTasks.has(taskId);
}

// ==================== 压缩/解压功能 ====================

// 压缩远程文件/文件夹
ipcMain.handle('ftp-compress', async (event, { configId, remotePaths, targetPath, format }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const tempDir = app.getPath('temp');
  const workDir = path.join(tempDir, `ftp-compress-${Date.now()}`);
  const archiveExt = format === 'tar.gz' ? '.tar.gz' : '.zip';
  const archiveName = path.basename(remotePaths[0], path.extname(remotePaths[0])) + (remotePaths.length > 1 ? '-等' : '') + archiveExt;
  const archivePath = path.join(tempDir, archiveName);

  const client = new Client();
  client.ftp.timeout = 300000;

  try {
    fs.mkdirSync(workDir, { recursive: true });

    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 下载所有文件到本地临时目录
    for (const remotePath of remotePaths) {
      const fileName = path.basename(remotePath);
      const localPath = path.join(workDir, fileName);

      try {
        // 尝试作为目录下载
        await client.downloadToDir(localPath, remotePath);
      } catch (e) {
        // 如果失败，尝试作为文件下载
        await client.downloadTo(localPath, remotePath);
      }
    }

    await client.close();

    // 创建压缩文件
    if (format === 'tar.gz') {
      await tar.create({ gzip: true, file: archivePath, cwd: workDir }, fs.readdirSync(workDir));
    } else {
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(archivePath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(workDir, false);
        archive.finalize();
      });
    }

    // 上传压缩文件到 FTP
    const client2 = new Client();
    client2.ftp.timeout = 300000;

    await client2.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    const uploadPath = path.posix.join(targetPath, archiveName);
    await client2.uploadFrom(archivePath, uploadPath);
    await client2.close();

    // 清理临时文件
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(archivePath, { force: true });

    return { success: true, archiveName };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    // 清理临时文件（忽略错误）
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) { }
    try { fs.rmSync(archivePath, { force: true }); } catch (e) { }
    return { success: false, error: error.message };
  }
});

// 解压远程压缩文件
ipcMain.handle('ftp-extract', async (event, { configId, remotePath, targetPath }) => {
  const configs = loadConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    return { success: false, error: '配置不存在' };
  }

  const tempDir = app.getPath('temp');
  const fileName = path.basename(remotePath);
  const localArchive = path.join(tempDir, `ftp-extract-${Date.now()}-${fileName}`);
  const extractDir = path.join(tempDir, `ftp-extract-${Date.now()}`);

  const client = new Client();
  client.ftp.timeout = 300000;

  try {
    fs.mkdirSync(extractDir, { recursive: true });

    await client.access({
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
      secure: config.secure || false,
      secureOptions: { rejectUnauthorized: false }
    });

    // 下载压缩文件
    await client.downloadTo(localArchive, remotePath);

    // 解压文件
    const ext = fileName.toLowerCase();
    if (ext.endsWith('.zip')) {
      await extractZip(localArchive, { dir: extractDir });
    } else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
      await tar.extract({ file: localArchive, cwd: extractDir });
    } else if (ext.endsWith('.tar')) {
      await tar.extract({ file: localArchive, cwd: extractDir });
    } else {
      throw new Error('不支持的压缩格式，仅支持 .zip, .tar, .tar.gz, .tgz');
    }

    // 上传解压后的文件
    await client.uploadFromDir(extractDir, targetPath);
    await client.close();

    // 清理临时文件
    fs.rmSync(localArchive, { force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });

    return { success: true };
  } catch (error) {
    try { await client.close(); } catch (e) { }
    // 清理临时文件（忽略错误）
    try { fs.rmSync(localArchive, { force: true }); } catch (e) { }
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e) { }
    return { success: false, error: error.message };
  }
});

// 应用启动时不自动启动监控，需要用户手动点击"启动"按钮
