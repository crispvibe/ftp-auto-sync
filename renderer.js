const { ipcRenderer } = require('electron');
const path = require('path');

// ==================== 窗口控制 ====================

// 检测平台并显示 Windows 窗口控制按钮
function initWindowControls() {
  // 通过 IPC 获取平台信息
  ipcRenderer.invoke('get-platform').then(platform => {
    if (platform !== 'darwin') {
      // 非 macOS 显示窗口控制按钮
      const controls = document.getElementById('windowControls');
      if (controls) {
        controls.classList.add('show');
      }
    }
  }).catch(() => {
    // 如果获取失败，默认不显示
  });
}

// 最小化窗口
function minimizeWindow() {
  ipcRenderer.send('window-minimize');
}

// 最大化/还原窗口
function maximizeWindow() {
  ipcRenderer.send('window-maximize');
}

// 关闭窗口
function closeWindow() {
  ipcRenderer.send('window-close');
}

// 监听窗口最大化状态变化
ipcRenderer.on('window-maximized', (event, isMaximized) => {
  const icon = document.getElementById('maximizeIcon');
  if (icon) {
    // 更新图标：最大化时显示还原图标，否则显示最大化图标
    icon.setAttribute('data-lucide', isMaximized ? 'copy' : 'square');
    lucide.createIcons();
  }
});

let configs = [];
let currentEditId = null;
let logs = {};
let selectedConfigId = null;

// 文件管理状态
let currentRemotePath = '/';
let fileTreeData = [];
let selectedFile = null;
let currentFileContent = null;
let isFileModified = false;
let contextMenuTarget = null;
let expandedDirs = new Set();
let isLogsCollapsed = false;
let codeEditor = null; // CodeMirror 实例

// 传输任务状态
let transferTasks = []; // { id, type, fileName, filePath, progress, speed, status, startTime }
let transferIdCounter = 0;
let isTransferPanelOpen = false;

// 剪贴板状态
let clipboard = {
  items: [], // { path, name, type }
  operation: null // 'copy' | 'cut'
};

// 导航历史
let navigationHistory = [];
let navigationIndex = -1;
let isNavigating = false; // 防止导航时重复添加历史

// FTP 连接状态
let connectedConfigs = new Set(); // 已连接的配置 ID

// Load configs on start
async function loadConfigs() {
  configs = await ipcRenderer.invoke('get-configs');
  // 自动选择第一个配置
  if (configs.length > 0 && !selectedConfigId) {
    selectedConfigId = configs[0].id;
  }
  renderConfigList();
  renderLogs();
}

function renderConfigList() {
  const list = document.getElementById('configList');
  
  if (configs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <i data-lucide="folder-open"></i>
        </div>
        <div class="empty-state-text">暂无配置</div>
        <div class="empty-state-subtext">点击上方按钮添加 FTP 配置</div>
      </div>
    `;
    lucide.createIcons();
    return;
  }
  
  list.innerHTML = configs.map(config => {
    const isConnected = connectedConfigs.has(config.id);
    const statusText = config.enabled ? '运行中' : (isConnected ? '已连接' : '已停止');
    const statusClass = config.enabled ? 'active' : (isConnected ? 'connected' : '');
    
    return `
    <div class="config-item ${selectedConfigId === config.id ? 'active' : ''}" data-id="${config.id}" onclick="selectConfig('${config.id}')" ondblclick="editConfig('${config.id}')">
      <div class="config-header">
        <div class="config-name">${config.name}</div>
        <div class="config-status">
          <div class="status-dot ${statusClass}"></div>
          <span style="font-size: 11px; color: #999;">${statusText}</span>
        </div>
      </div>
      <div class="config-info">
        <i data-lucide="folder"></i>
        <span>${config.localPath}</span>
      </div>
      <div class="config-info">
        <i data-lucide="globe"></i>
        <span>${maskHost(config.host)}</span>
      </div>
      <div class="config-info">
        <i data-lucide="map-pin"></i>
        <span>${config.remotePath || '/'}</span>
      </div>
      <div class="config-actions">
        <button class="btn-small btn-test-config ${isConnected ? 'connected' : ''}" onclick="event.stopPropagation(); ${isConnected ? `disconnectFtp('${config.id}')` : `connectFtp('${config.id}', event)`}">${isConnected ? '断开' : '连接'}</button>
        <button class="btn-small btn-toggle ${config.enabled ? '' : 'disabled'}" onclick="event.stopPropagation(); toggleConfig('${config.id}', ${!config.enabled})">
          ${config.enabled ? '停止' : '启动'}
        </button>
        <button class="btn-small btn-edit" onclick="event.stopPropagation(); editConfig('${config.id}')">编辑</button>
        <button class="btn-small btn-delete" onclick="event.stopPropagation(); deleteConfig('${config.id}')">删除</button>
      </div>
    </div>
  `;
  }).join('');
  
  // Re-initialize Lucide icons for newly added elements
  lucide.createIcons();
}

function renderLogs() {
  const logEntries = document.getElementById('logEntries');
  if (!logEntries) return;
  
  // 如果没有选中的配置
  if (!selectedConfigId) {
    logEntries.innerHTML = '<div style="padding: 10px; text-align: center; color: #555; font-size: 10px;">选择配置查看日志</div>';
    return;
  }
  
  const configLogs = logs[selectedConfigId] || [];
  
  if (configLogs.length === 0) {
    logEntries.innerHTML = '<div style="padding: 10px; text-align: center; color: #555; font-size: 10px;">暂无日志</div>';
    return;
  }
  
  // 显示日志（最新的在底部）
  logEntries.innerHTML = configLogs.slice(-200).map(log => `
    <div class="log-entry ${log.type}">
      <span class="log-time">${formatTime(log.timestamp)}</span>
      <span class="log-message">${log.message}</span>
    </div>
  `).join('');
  
  // 自动滚动到底部
  logEntries.scrollTop = logEntries.scrollHeight;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function maskHost(host) {
  // Hide most of the IP/hostname, only show first few characters
  if (!host) return '';
  if (host.length <= 4) return host;
  return host.substring(0, 3) + '***';
}

async function selectConfig(configId) {
  selectedConfigId = configId;
  currentRemotePath = '/';
  selectedFile = null;
  isFileModified = false;
  expandedDirs.clear();
  
  // 重置导航历史
  resetNavigationHistory();
  
  renderConfigList();
  renderLogs();
  
  // 加载文件树
  await loadFileTree();
}

// 连接 FTP（仅查看文件，不启动监控）
async function connectFtp(configId, event) {
  const config = configs.find(c => c.id === configId);
  if (!config) return;
  
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = '连接中...';
  btn.disabled = true;
  
  // 先测试连接
  const result = await ipcRenderer.invoke('test-ftp-connection', {
    host: config.host,
    port: config.port || 21,
    username: config.username,
    password: config.password,
    secure: config.secure || false
  });
  
  btn.textContent = originalText;
  btn.disabled = false;
  
  if (result.success) {
    // 连接成功，标记为已连接
    connectedConfigs.add(configId);
    
    // 选中该配置并加载文件树
    selectedConfigId = configId;
    currentRemotePath = config.remotePath || '/';
    selectedFile = null;
    isFileModified = false;
    expandedDirs.clear();
    
    renderConfigList();
    renderLogs();
    await loadFileTree();
    
    showToast('success', '连接成功', '已连接到 FTP 服务器');
  } else {
    // 连接失败，移除连接状态
    connectedConfigs.delete(configId);
    renderConfigList();
    showToast('error', '连接失败', result.message);
  }
}

// 断开 FTP 连接
function disconnectFtp(configId) {
  connectedConfigs.delete(configId);
  
  // 如果断开的是当前选中的配置，清空文件树
  if (selectedConfigId === configId) {
    fileTreeData = [];
    selectedFile = null;
    currentFileContent = null;
    isFileModified = false;
    navigationHistory = [];
    navigationIndex = -1;
    showFileManagerEmpty();
  }
  
  renderConfigList();
  showToast('info', '已断开', '已断开 FTP 连接');
}

// 测试连接（用于编辑/添加配置时）
async function testConfigConnection(configId, event) {
  const config = configs.find(c => c.id === configId);
  if (!config) return;
  
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = '测试中...';
  btn.disabled = true;
  
  const result = await ipcRenderer.invoke('test-ftp-connection', {
    host: config.host,
    port: config.port || 21,
    username: config.username,
    password: config.password,
    secure: config.secure || false
  });
  
  btn.textContent = originalText;
  btn.disabled = false;
  
  if (result.success) {
    showToast('success', '连接成功', 'FTP 服务器连接测试成功');
  } else {
    showToast('error', '连接失败', result.message);
  }
}

function clearLogs(configId, event) {
  const config = configs.find(c => c.id === configId);
  if (!config) return;
  
  // 确认清除
  if (logs[configId] && logs[configId].length > 0) {
    const btn = event.target.closest('.log-copy-btn');
    const originalText = btn.innerHTML;
    
    // 清除日志
    logs[configId] = [];
    
    // 显示反馈
    btn.innerHTML = '<i data-lucide="check"></i><span>已清除</span>';
    lucide.createIcons();
    
    setTimeout(() => {
      btn.innerHTML = originalText;
      lucide.createIcons();
      renderLogs();
    }, 1000);
  }
}

function copyLogs(configId, event) {
  const config = configs.find(c => c.id === configId);
  if (!config || !logs[configId]) return;
  
  const logText = logs[configId]
    .map(log => `[${formatTime(log.timestamp)}] ${log.message}`)
    .join('\n');
  
  navigator.clipboard.writeText(logText).then(() => {
    // Show feedback
    const btn = event.target.closest('.log-copy-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="check"></i><span>已复制</span>';
    lucide.createIcons();
    
    setTimeout(() => {
      btn.innerHTML = originalText;
      lucide.createIcons();
    }, 2000);
  }).catch(err => {
    showToast('error', '复制失败', err.message);
  });
}

// 清除当前配置的日志
function clearCurrentLogs(event) {
  if (!selectedConfigId) return;
  clearLogs(selectedConfigId, event);
}

// 复制当前配置的日志
function copyCurrentLogs(event) {
  if (!selectedConfigId) return;
  copyLogs(selectedConfigId, event);
}

function showAddModal() {
  currentEditId = null;
  document.getElementById('modalTitle').textContent = '添加 FTP 配置';
  document.getElementById('configForm').reset();
  document.getElementById('ftpPort').value = '21';
  document.getElementById('remotePath').value = '/';
  document.getElementById('uploadNew').checked = true;
  // 清空排除文件夹列表
  renderExcludeFolders([]);
  document.getElementById('configModal').classList.add('show');
  lucide.createIcons();
}

// 渲染排除文件夹列表
function renderExcludeFolders(folders) {
  const container = document.getElementById('excludeFoldersContainer');
  if (!folders || folders.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = folders.map((folder, index) => `
    <div class="exclude-folder-item" data-index="${index}">
      <input type="text" value="${folder}" placeholder="文件夹路径" onchange="updateExcludeFolder(${index}, this.value)">
      <button type="button" class="btn-browse-exclude" onclick="browseExcludeFolder(${index})">浏览</button>
      <button type="button" class="btn-remove-exclude" onclick="removeExcludeFolder(${index})">
        <i data-lucide="x"></i>
      </button>
    </div>
  `).join('');
  
  lucide.createIcons();
}

// 添加排除文件夹（手动输入）
function addExcludeFolder() {
  const container = document.getElementById('excludeFoldersContainer');
  const items = container.querySelectorAll('.exclude-folder-item');
  const index = items.length;
  
  const div = document.createElement('div');
  div.className = 'exclude-folder-item';
  div.dataset.index = index;
  div.innerHTML = `
    <input type="text" value="" placeholder="文件夹路径，如: node_modules" onchange="updateExcludeFolder(${index}, this.value)">
    <button type="button" class="btn-browse-exclude" onclick="browseExcludeFolder(${index})">浏览</button>
    <button type="button" class="btn-remove-exclude" onclick="removeExcludeFolder(${index})">
      <i data-lucide="x"></i>
    </button>
  `;
  
  container.appendChild(div);
  lucide.createIcons();
  
  // 聚焦到新添加的输入框
  div.querySelector('input').focus();
}

// 浏览选择排除文件夹
async function browseExcludeFolder(index) {
  const localPath = document.getElementById('localPath').value.trim();
  
  const result = await ipcRenderer.invoke('select-directory', localPath || undefined);
  if (result) {
    const container = document.getElementById('excludeFoldersContainer');
    const items = container.querySelectorAll('.exclude-folder-item');
    if (items[index]) {
      const input = items[index].querySelector('input');
      
      // 如果选择的是本地监控目录的子目录，只保留相对路径
      if (localPath && result.startsWith(localPath)) {
        let relativePath = result.substring(localPath.length);
        if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
          relativePath = relativePath.substring(1);
        }
        input.value = relativePath;
      } else {
        input.value = result;
      }
    }
  }
}

// 选择多个排除文件夹
async function selectExcludeFolders() {
  const localPath = document.getElementById('localPath').value.trim();
  
  const result = await ipcRenderer.invoke('select-multiple-directories', localPath || undefined);
  if (result && result.length > 0) {
    result.forEach(folderPath => {
      // 如果选择的是本地监控目录的子目录，只保留相对路径
      let value = folderPath;
      if (localPath && folderPath.startsWith(localPath)) {
        let relativePath = folderPath.substring(localPath.length);
        if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
          relativePath = relativePath.substring(1);
        }
        value = relativePath;
      }
      
      // 添加到列表
      const container = document.getElementById('excludeFoldersContainer');
      const items = container.querySelectorAll('.exclude-folder-item');
      const index = items.length;
      
      const div = document.createElement('div');
      div.className = 'exclude-folder-item';
      div.dataset.index = index;
      div.innerHTML = `
        <input type="text" value="${value}" placeholder="文件夹路径" onchange="updateExcludeFolder(${index}, this.value)">
        <button type="button" class="btn-browse-exclude" onclick="browseExcludeFolder(${index})">浏览</button>
        <button type="button" class="btn-remove-exclude" onclick="removeExcludeFolder(${index})">
          <i data-lucide="x"></i>
        </button>
      `;
      
      container.appendChild(div);
    });
    lucide.createIcons();
  }
}

// 移除排除文件夹
function removeExcludeFolder(index) {
  const container = document.getElementById('excludeFoldersContainer');
  const items = container.querySelectorAll('.exclude-folder-item');
  if (items[index]) {
    items[index].remove();
  }
  // 重新设置索引
  container.querySelectorAll('.exclude-folder-item').forEach((item, i) => {
    item.dataset.index = i;
    item.querySelector('input').setAttribute('onchange', `updateExcludeFolder(${i}, this.value)`);
    const browseBtn = item.querySelectorAll('button')[0];
    const removeBtn = item.querySelectorAll('button')[1];
    if (browseBtn) browseBtn.setAttribute('onclick', `browseExcludeFolder(${i})`);
    if (removeBtn) removeBtn.setAttribute('onclick', `removeExcludeFolder(${i})`);
  });
}

// 获取所有排除文件夹
function getExcludeFolders() {
  const container = document.getElementById('excludeFoldersContainer');
  const inputs = container.querySelectorAll('.exclude-folder-item input');
  const folders = [];
  inputs.forEach(input => {
    const value = input.value.trim();
    if (value) {
      folders.push(value);
    }
  });
  return folders;
}

function closeModal() {
  document.getElementById('configModal').classList.remove('show');
  currentEditId = null;
}

async function selectDirectory() {
  const path = await ipcRenderer.invoke('select-directory');
  if (path) {
    document.getElementById('localPath').value = path;
  }
}

async function testConnection(event) {
  const config = {
    host: document.getElementById('ftpHost').value.trim(),
    port: parseInt(document.getElementById('ftpPort').value) || 21,
    username: document.getElementById('ftpUsername').value.trim(),
    password: document.getElementById('ftpPassword').value.trim(),
    secure: document.getElementById('secureConnection').checked
  };
  
  if (!config.host || !config.username || !config.password) {
    showToast('error', '信息不完整', '请填写 FTP 主机、用户名和密码');
    return;
  }
  
  const btn = event.target;
  btn.textContent = '测试中...';
  btn.disabled = true;
  
  const result = await ipcRenderer.invoke('test-ftp-connection', config);
  
  btn.textContent = '测试连接';
  btn.disabled = false;
  
  if (result.success) {
    showToast('success', '连接成功', 'FTP 服务器连接测试成功');
  } else {
    showToast('error', '连接失败', result.message);
  }
}

document.getElementById('configForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const config = {
    id: currentEditId,
    name: document.getElementById('configName').value.trim(),
    localPath: document.getElementById('localPath').value.trim(),
    host: document.getElementById('ftpHost').value.trim(),
    port: parseInt(document.getElementById('ftpPort').value) || 21,
    username: document.getElementById('ftpUsername').value.trim(),
    password: document.getElementById('ftpPassword').value.trim(),
    remotePath: document.getElementById('remotePath').value.trim() || '/',
    secure: document.getElementById('secureConnection').checked,
    uploadNew: document.getElementById('uploadNew').checked,
    excludeFolders: getExcludeFolders() // 排除文件夹列表
  };
  
  configs = await ipcRenderer.invoke('save-config', config);
  renderConfigList();
  closeModal();
});

async function toggleConfig(id, enabled) {
  configs = await ipcRenderer.invoke('toggle-config', id, enabled);
  renderConfigList();
}

function editConfig(id) {
  const config = configs.find(c => c.id === id);
  if (!config) return;
  
  currentEditId = id;
  document.getElementById('modalTitle').textContent = '编辑 FTP 配置';
  document.getElementById('configName').value = config.name;
  document.getElementById('localPath').value = config.localPath;
  document.getElementById('ftpHost').value = config.host;
  document.getElementById('ftpPort').value = config.port || 21;
  document.getElementById('ftpUsername').value = config.username;
  document.getElementById('ftpPassword').value = config.password;
  document.getElementById('remotePath').value = config.remotePath || '/';
  document.getElementById('secureConnection').checked = config.secure || false;
  document.getElementById('uploadNew').checked = config.uploadNew !== false;
  // 加载排除文件夹列表
  renderExcludeFolders(config.excludeFolders || []);
  document.getElementById('configModal').classList.add('show');
  lucide.createIcons();
}

async function deleteConfig(id) {
  const config = configs.find(c => c.id === id);
  const configName = config ? config.name : '此配置';
  
  const confirmed = await showConfirm(
    '删除配置',
    `确定要删除配置 "${configName}" 吗？此操作无法撤销。`
  );
  
  if (!confirmed) return;
  
  configs = await ipcRenderer.invoke('delete-config', id);
  delete logs[id];
  
  // 如果删除的是当前选中的配置，重新选择
  if (selectedConfigId === id) {
    selectedConfigId = configs.length > 0 ? configs[0].id : null;
  }
  
  renderConfigList();
  renderLogs();
}

// Listen for log messages
ipcRenderer.on('log-message', (event, log) => {
  if (!logs[log.configId]) {
    logs[log.configId] = [];
  }
  
  logs[log.configId].push(log);
  
  // Keep only last 100 logs per config
  if (logs[log.configId].length > 100) {
    logs[log.configId] = logs[log.configId].slice(-100);
  }
  
  renderLogs();
});

// Close modal on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
  }
});

// 自定义通知弹窗
function showToast(type, title, message) {
  const toast = document.getElementById('toast');
  const overlay = document.getElementById('toastOverlay');
  const icon = document.getElementById('toastIcon');
  const titleEl = document.getElementById('toastTitle');
  const messageEl = document.getElementById('toastMessage');
  
  // 设置图标
  const icons = {
    success: '<i data-lucide="check-circle"></i>',
    error: '<i data-lucide="x-circle"></i>',
    info: '<i data-lucide="info"></i>'
  };
  
  icon.innerHTML = icons[type] || icons.info;
  titleEl.textContent = title;
  messageEl.textContent = message;
  
  // 移除之前的类型类
  toast.classList.remove('success', 'error', 'info');
  toast.classList.add(type);
  
  // 显示弹窗
  overlay.classList.add('show');
  toast.classList.add('show');
  
  // 初始化图标
  lucide.createIcons();
  
  // 3秒后自动关闭
  setTimeout(() => {
    overlay.classList.remove('show');
    toast.classList.remove('show');
  }, 3000);
  
  // 点击遮罩关闭
  overlay.onclick = () => {
    overlay.classList.remove('show');
    toast.classList.remove('show');
  };
}

// 自定义确认对话框
function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmOverlay');
    const dialog = document.getElementById('confirmDialog');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const cancelBtn = document.getElementById('confirmCancel');
    const okBtn = document.getElementById('confirmOk');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    // 显示对话框
    overlay.classList.add('show');
    dialog.classList.add('show');
    
    // 初始化图标
    lucide.createIcons();
    
    // 处理确认
    const handleOk = () => {
      cleanup();
      resolve(true);
    };
    
    // 处理取消
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };
    
    // 清理函数
    const cleanup = () => {
      overlay.classList.remove('show');
      dialog.classList.remove('show');
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      overlay.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleKeydown);
    };
    
    // 键盘事件处理
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleOk();
      }
    };
    
    // 绑定事件
    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleKeydown);
    
    // 聚焦确认按钮
    okBtn.focus();
  });
}

// 打开 GitHub 仓库
function openGitHub(event) {
  event.preventDefault();
  const { shell } = require('electron');
  shell.openExternal('https://github.com/crispvibe/ftp-auto-sync');
}

// Listen for menu events
ipcRenderer.on('new-config', () => {
  showAddModal();
});

// 监听传输进度更新
ipcRenderer.on('transfer-progress', (event, { taskId, progress, speed }) => {
  updateTransferProgress(taskId, progress, speed);
});

// 监听传输完成
ipcRenderer.on('transfer-complete', (event, { taskId, success, error }) => {
  completeTransferTask(taskId, success, error);
});

// 监听添加传输任务（从主进程）
ipcRenderer.on('add-transfer-task', (event, { type, fileName, filePath, taskId }) => {
  // 如果主进程提供了 taskId，使用它；否则生成新的
  if (taskId) {
    const task = {
      id: taskId,
      type,
      fileName,
      filePath,
      progress: 0,
      speed: '',
      status: 'pending',
      startTime: Date.now(),
      error: null
    };
    transferTasks.unshift(task);
    openTransferPanel();
    renderTransferPanel();
  } else {
    addTransferTask(type, fileName, filePath);
  }
});

// 自动去除输入框首尾空格
function setupAutoTrim() {
  const inputIds = ['configName', 'localPath', 'ftpHost', 'ftpUsername', 'ftpPassword', 'remotePath'];
  
  inputIds.forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('blur', function() {
        this.value = this.value.trim();
      });
    }
  });
}

// 在页面加载后设置自动去除空格
document.addEventListener('DOMContentLoaded', () => {
  initWindowControls(); // 初始化窗口控制按钮
  setupAutoTrim();
  setupFileManager();
  setupDragAndDrop();
  setupContextMenu();
  setupKeyboardShortcuts();
  setupLogsResizer();
  setupTreeResizer();
  setupSidebarResizer();
});

// Initialize
loadConfigs();

// ==================== 文件管理功能 ====================

// 初始化文件管理器
function setupFileManager() {
  // 初始化 CodeMirror 编辑器
  const textarea = document.getElementById('editorTextarea');
  if (textarea && typeof CodeMirror !== 'undefined') {
    codeEditor = CodeMirror.fromTextArea(textarea, {
      theme: 'material-darker',
      lineNumbers: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      autoCloseBrackets: true,
      matchBrackets: true,
      styleActiveLine: true,
      mode: 'javascript' // 默认模式
    });

    // 编辑器内容变化监听
    codeEditor.on('change', () => {
      if (selectedFile && currentFileContent !== null) {
        isFileModified = codeEditor.getValue() !== currentFileContent;
        updateEditorTitle();
      }
    });

    // 设置编辑器高度
    codeEditor.setSize('100%', '100%');
  }
}

// 加载文件树
async function loadFileTree() {
  if (!selectedConfigId) {
    showFileManagerEmpty();
    return;
  }

  const config = configs.find(c => c.id === selectedConfigId);
  if (!config) {
    showFileManagerEmpty();
    return;
  }

  // 显示文件树和编辑器
  document.getElementById('fileManagerEmpty').style.display = 'none';
  document.getElementById('fileTree').style.display = 'flex';
  document.getElementById('fileEditorEmpty').style.display = 'flex';
  document.getElementById('fileEditor').style.display = 'none';

  const treeContent = document.getElementById('fileTreeContent');
  treeContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">加载中...</div>';
  lucide.createIcons();

  const remotePath = config.remotePath || '/';
  const result = await ipcRenderer.invoke('ftp-list-dir', {
    configId: selectedConfigId,
    remotePath: remotePath
  });

  if (result.success) {
    fileTreeData = result.files;
    currentRemotePath = remotePath;
    
    // 标记为已连接
    connectedConfigs.add(selectedConfigId);
    renderConfigList();
    
    // 初始化导航历史（将初始路径添加到历史）
    if (navigationHistory.length === 0) {
      navigationHistory.push(remotePath);
      navigationIndex = 0;
    }
    
    renderFileTree();
    updateNavigationButtons();
    updatePathDisplay();
  } else {
    // 连接失败，移除连接状态
    connectedConfigs.delete(selectedConfigId);
    renderConfigList();
    treeContent.innerHTML = `<div style="padding: 20px; text-align: center; color: #d85656;">加载失败: ${result.error}</div>`;
  }
}

// 显示空状态
function showFileManagerEmpty() {
  document.getElementById('fileManagerEmpty').style.display = 'flex';
  document.getElementById('fileTree').style.display = 'none';
  document.getElementById('fileEditor').style.display = 'none';
  document.getElementById('fileEditorEmpty').style.display = 'none';
  lucide.createIcons();
}

// 渲染文件树
function renderFileTree() {
  const treeContent = document.getElementById('fileTreeContent');
  
  if (fileTreeData.length === 0) {
    treeContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">目录为空</div>';
    return;
  }

  let html = '';
  
  // 添加返回上级目录
  const config = configs.find(c => c.id === selectedConfigId);
  const basePath = config ? (config.remotePath || '/') : '/';
  
  if (currentRemotePath !== basePath && currentRemotePath !== '/') {
    html += `
      <div class="tree-item" onclick="navigateUp()">
        <div class="tree-item-icon folder">
          <i data-lucide="corner-left-up"></i>
        </div>
        <span class="tree-item-name">..</span>
      </div>
    `;
  }

  fileTreeData.forEach(file => {
    const isDir = file.type === 'directory';
    const icon = isDir ? 'folder' : getFileIcon(file.name);
    const iconClass = isDir ? 'folder' : 'file';
    const sizeText = isDir ? '' : formatFileSize(file.size);
    
    html += `
      <div class="tree-item ${selectedFile && selectedFile.path === file.path ? 'selected' : ''}" 
           data-path="${file.path}" 
           data-type="${file.type}"
           data-name="${file.name}"
           onclick="selectFile(this)"
           ondblclick="openFile(this)"
           oncontextmenu="showContextMenu(event, this)"
           draggable="true"
           ondragstart="handleDragStart(event, this)">
        <div class="tree-item-icon ${iconClass}">
          <i data-lucide="${icon}"></i>
        </div>
        <span class="tree-item-name">${file.name}</span>
        ${sizeText ? `<span class="tree-item-size">${sizeText}</span>` : ''}
      </div>
    `;
  });

  treeContent.innerHTML = html;
  lucide.createIcons();
}

// 获取文件图标
function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const iconMap = {
    'js': 'file-code',
    'ts': 'file-code',
    'jsx': 'file-code',
    'tsx': 'file-code',
    'html': 'file-code',
    'htm': 'file-code',
    'css': 'file-code',
    'scss': 'file-code',
    'less': 'file-code',
    'json': 'file-json',
    'xml': 'file-code',
    'php': 'file-code',
    'py': 'file-code',
    'rb': 'file-code',
    'java': 'file-code',
    'c': 'file-code',
    'cpp': 'file-code',
    'h': 'file-code',
    'md': 'file-text',
    'txt': 'file-text',
    'log': 'file-text',
    'jpg': 'image',
    'jpeg': 'image',
    'png': 'image',
    'gif': 'image',
    'svg': 'image',
    'webp': 'image',
    'ico': 'image',
    'pdf': 'file-text',
    'zip': 'file-archive',
    'rar': 'file-archive',
    'tar': 'file-archive',
    'gz': 'file-archive',
    '7z': 'file-archive'
  };
  return iconMap[ext] || 'file';
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 选择文件
function selectFile(element) {
  const filePath = element.dataset.path;
  const fileType = element.dataset.type;
  const fileName = element.dataset.name;

  // 更新选中状态
  document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
  element.classList.add('selected');

  selectedFile = {
    path: filePath,
    type: fileType,
    name: fileName
  };
}

// 打开文件
async function openFile(element) {
  const filePath = element.dataset.path;
  const fileType = element.dataset.type;
  const fileName = element.dataset.name;

  if (fileType === 'directory') {
    // 进入目录
    await navigateToDir(filePath);
  } else {
    // 打开文件编辑
    await loadFileContent(filePath, fileName);
  }
}

// 进入目录
async function navigateToDir(dirPath, addToHistory = true) {
  const treeContent = document.getElementById('fileTreeContent');
  treeContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">加载中...</div>';

  const result = await ipcRenderer.invoke('ftp-list-dir', {
    configId: selectedConfigId,
    remotePath: dirPath
  });

  if (result.success) {
    fileTreeData = result.files;
    currentRemotePath = dirPath;
    
    // 添加到导航历史
    if (addToHistory && !isNavigating) {
      // 如果当前不在历史末尾，删除后面的历史
      if (navigationIndex < navigationHistory.length - 1) {
        navigationHistory = navigationHistory.slice(0, navigationIndex + 1);
      }
      navigationHistory.push(dirPath);
      navigationIndex = navigationHistory.length - 1;
    }
    
    renderFileTree();
    updateNavigationButtons();
    updatePathDisplay();
  } else {
    showToast('error', '加载失败', result.error);
    renderFileTree();
  }
}

// 返回上级目录
async function navigateUp() {
  if (currentRemotePath === '/' || currentRemotePath === '') return;
  
  // 获取配置的基础路径
  const config = configs.find(c => c.id === selectedConfigId);
  const basePath = config ? (config.remotePath || '/') : '/';
  
  // 如果已经在基础路径，不再向上
  if (currentRemotePath === basePath) return;
  
  const parentPath = path.posix.dirname(currentRemotePath);
  
  // 确保不会超出基础路径
  if (basePath !== '/' && !parentPath.startsWith(basePath) && parentPath !== basePath) {
    await navigateToDir(basePath);
  } else {
    await navigateToDir(parentPath);
  }
}

// 后退
async function navigateBack() {
  if (navigationIndex <= 0) return;
  
  isNavigating = true;
  navigationIndex--;
  await navigateToDir(navigationHistory[navigationIndex], false);
  isNavigating = false;
  updateNavigationButtons();
}

// 前进
async function navigateForward() {
  if (navigationIndex >= navigationHistory.length - 1) return;
  
  isNavigating = true;
  navigationIndex++;
  await navigateToDir(navigationHistory[navigationIndex], false);
  isNavigating = false;
  updateNavigationButtons();
}

// 更新导航按钮状态
function updateNavigationButtons() {
  const backBtn = document.getElementById('navBackBtn');
  const forwardBtn = document.getElementById('navForwardBtn');
  const upBtn = document.getElementById('navUpBtn');
  
  // 获取配置的基础路径
  const config = configs.find(c => c.id === selectedConfigId);
  const basePath = config ? (config.remotePath || '/') : '/';
  
  if (backBtn) {
    backBtn.disabled = navigationIndex <= 0;
  }
  if (forwardBtn) {
    forwardBtn.disabled = navigationIndex >= navigationHistory.length - 1;
  }
  if (upBtn) {
    // 如果已经在基础路径或根目录，禁用向上按钮
    upBtn.disabled = currentRemotePath === basePath || currentRemotePath === '/' || currentRemotePath === '';
  }
}

// 更新路径显示
function updatePathDisplay() {
  const pathDisplay = document.getElementById('currentPathDisplay');
  if (pathDisplay) {
    pathDisplay.textContent = currentRemotePath || '/';
    pathDisplay.title = currentRemotePath || '/';
  }
}

// 重置导航历史（切换配置时调用）
function resetNavigationHistory() {
  navigationHistory = [];
  navigationIndex = -1;
  isNavigating = false;
}

// 根据文件扩展名获取 CodeMirror 语法模式
function getCodeMirrorMode(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const modeMap = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'javascript',
    'tsx': 'javascript',
    'json': { name: 'javascript', json: true },
    'html': 'htmlmixed',
    'htm': 'htmlmixed',
    'xml': 'xml',
    'svg': 'xml',
    'css': 'css',
    'scss': 'css',
    'less': 'css',
    'php': 'php',
    'py': 'python',
    'rb': 'ruby',
    'java': 'text/x-java',
    'c': 'text/x-csrc',
    'cpp': 'text/x-c++src',
    'h': 'text/x-csrc',
    'cs': 'text/x-csharp',
    'sql': 'sql',
    'md': 'markdown',
    'markdown': 'markdown',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'yaml': 'yaml',
    'yml': 'yaml',
    'txt': 'text/plain',
    'log': 'text/plain'
  };
  return modeMap[ext] || 'text/plain';
}

// 检查是否为图片文件
function isImageFile(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext);
}

// 加载文件内容
async function loadFileContent(filePath, fileName) {
  // 检查是否有未保存的更改
  if (isFileModified) {
    const confirmed = await showConfirm('未保存的更改', '当前文件有未保存的更改，是否放弃更改？');
    if (!confirmed) return;
  }

  document.getElementById('fileEditorEmpty').style.display = 'none';
  document.getElementById('fileEditor').style.display = 'flex';
  
  document.getElementById('editorFilePath').textContent = fileName;

  // 隐藏图片预览容器（如果存在）
  const imagePreview = document.getElementById('imagePreviewContainer');
  const editorContainer = document.getElementById('editorContainer');
  if (imagePreview) imagePreview.style.display = 'none';
  if (editorContainer) editorContainer.style.display = 'block';

  // 检查是否为图片文件
  if (isImageFile(fileName)) {
    await loadImagePreview(filePath, fileName);
    return;
  }

  // 显示加载状态
  if (codeEditor) {
    codeEditor.setValue('加载中...');
    codeEditor.setOption('readOnly', true);
  }

  const result = await ipcRenderer.invoke('ftp-read-file', {
    configId: selectedConfigId,
    remotePath: filePath
  });

  if (result.success) {
    if (codeEditor) {
      // 二进制文件使用纯文本模式，其他文件根据扩展名设置语法模式
      if (result.isBinary) {
        codeEditor.setOption('mode', 'text/plain');
        codeEditor.setOption('readOnly', true); // 二进制文件只读
      } else {
        const mode = getCodeMirrorMode(fileName);
        codeEditor.setOption('mode', mode);
        codeEditor.setOption('readOnly', false);
      }
      
      // 设置内容
      codeEditor.setValue(result.content);
      
      // 刷新编辑器
      setTimeout(() => codeEditor.refresh(), 10);
    }
    
    currentFileContent = result.content;
    isFileModified = false;
    selectedFile = { path: filePath, name: fileName, type: 'file', isBinary: result.isBinary };
    updateEditorTitle();
    
    // 二进制文件提示
    if (result.isBinary) {
      document.getElementById('editorFilePath').textContent = fileName + ' (二进制预览)';
    }
  } else {
    if (codeEditor) {
      codeEditor.setValue('');
      codeEditor.setOption('readOnly', true);
    }
    document.getElementById('editorFilePath').textContent = '加载失败';
    showToast('error', '加载失败', result.error);
  }
  
  lucide.createIcons();
}

// 加载图片预览
async function loadImagePreview(filePath, fileName) {
  // 获取或创建图片预览容器
  let imagePreview = document.getElementById('imagePreviewContainer');
  const editorContainer = document.getElementById('editorContainer');
  
  if (!imagePreview) {
    imagePreview = document.createElement('div');
    imagePreview.id = 'imagePreviewContainer';
    imagePreview.style.cssText = `
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #0a0a0a;
      overflow: auto;
      padding: 20px;
    `;
    editorContainer.parentNode.insertBefore(imagePreview, editorContainer.nextSibling);
  }
  
  // 隐藏代码编辑器，显示图片预览
  editorContainer.style.display = 'none';
  imagePreview.style.display = 'flex';
  
  // 显示加载状态
  imagePreview.innerHTML = `
    <div style="color: #666; text-align: center;">
      <div style="margin-bottom: 10px;">加载图片中...</div>
    </div>
  `;
  
  // 下载图片到临时文件
  const result = await ipcRenderer.invoke('ftp-download-image', {
    configId: selectedConfigId,
    remotePath: filePath
  });
  
  if (result.success) {
    const img = document.createElement('img');
    img.src = `file://${result.tempPath}?t=${Date.now()}`; // 添加时间戳避免缓存
    img.style.cssText = `
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 4px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
    
    img.onload = () => {
      imagePreview.innerHTML = '';
      
      // 图片信息
      const info = document.createElement('div');
      info.style.cssText = `
        margin-bottom: 15px;
        color: #888;
        font-size: 12px;
        text-align: center;
      `;
      info.textContent = `${img.naturalWidth} x ${img.naturalHeight} 像素`;
      
      imagePreview.appendChild(info);
      imagePreview.appendChild(img);
    };
    
    img.onerror = () => {
      imagePreview.innerHTML = `
        <div style="color: #d85656; text-align: center;">
          <div style="font-size: 14px; margin-bottom: 5px;">图片加载失败</div>
          <div style="font-size: 12px; color: #666;">请尝试下载后查看</div>
        </div>
      `;
    };
    
    selectedFile = { path: filePath, name: fileName, type: 'file', isImage: true };
    isFileModified = false;
    document.getElementById('editorFilePath').textContent = fileName + ' (图片预览)';
  } else {
    imagePreview.innerHTML = `
      <div style="color: #d85656; text-align: center;">
        <div style="font-size: 14px; margin-bottom: 5px;">加载失败</div>
        <div style="font-size: 12px; color: #666;">${result.error}</div>
      </div>
    `;
  }
  
  lucide.createIcons();
}

// 更新编辑器标题
function updateEditorTitle() {
  const titleEl = document.getElementById('editorFilePath');
  if (selectedFile) {
    titleEl.textContent = selectedFile.name + (isFileModified ? ' *' : '');
  }
}

// 保存当前文件
async function saveCurrentFile() {
  if (!selectedFile || selectedFile.type !== 'file') {
    showToast('error', '保存失败', '没有选中的文件');
    return;
  }

  // 二进制文件和图片不能保存
  if (selectedFile.isBinary || selectedFile.isImage) {
    showToast('info', '提示', '此类型文件不支持在线编辑，请下载后使用专业工具');
    return;
  }

  if (!selectedConfigId) {
    showToast('error', '保存失败', '没有选中的配置');
    return;
  }

  // 从 CodeMirror 获取内容
  const content = codeEditor ? codeEditor.getValue() : '';
  const fileSize = new Blob([content]).size;
  const fileSizeKB = (fileSize / 1024).toFixed(2);

  // 添加保存中的日志
  addLocalLog(selectedConfigId, `正在保存 Saving | 文件 File: ${selectedFile.name} | 大小 Size: ${fileSizeKB} KB`, 'info');

  const result = await ipcRenderer.invoke('ftp-save-file', {
    configId: selectedConfigId,
    remotePath: selectedFile.path,
    content: content
  });

  if (result.success) {
    currentFileContent = content;
    isFileModified = false;
    updateEditorTitle();
    // 添加保存成功的日志
    addLocalLog(selectedConfigId, `保存成功 Save Success | 文件 File: ${selectedFile.name} | 路径 Path: ${selectedFile.path} | 大小 Size: ${fileSizeKB} KB`, 'success');
    showToast('success', '保存成功', `${selectedFile.name} 已保存`);
  } else {
    addLocalLog(selectedConfigId, `保存失败 Save Failed | 文件 File: ${selectedFile.name} | 错误 Error: ${result.error}`, 'error');
    showToast('error', '保存失败', result.error);
  }
}

// 添加本地日志（用于编辑器操作）
function addLocalLog(configId, message, type) {
  if (!logs[configId]) {
    logs[configId] = [];
  }
  logs[configId].push({
    message,
    type,
    timestamp: new Date().toISOString()
  });
  renderLogs();
}

// 编辑器全屏状态
let isEditorFullscreen = false;

// 切换编辑器全屏
function toggleEditorFullscreen() {
  const editor = document.getElementById('fileEditor');
  const icon = document.getElementById('fullscreenIcon');
  
  if (!editor) return;
  
  isEditorFullscreen = !isEditorFullscreen;
  
  if (isEditorFullscreen) {
    editor.classList.add('fullscreen');
    if (icon) {
      icon.setAttribute('data-lucide', 'minimize-2');
    }
  } else {
    editor.classList.remove('fullscreen');
    if (icon) {
      icon.setAttribute('data-lucide', 'maximize-2');
    }
  }
  
  // 重新渲染图标
  lucide.createIcons();
  
  // 刷新 CodeMirror 编辑器
  if (codeEditor) {
    setTimeout(() => codeEditor.refresh(), 50);
  }
}

// 退出全屏（ESC 键）
function exitEditorFullscreen() {
  if (isEditorFullscreen) {
    toggleEditorFullscreen();
  }
}

// 下载当前文件
async function downloadCurrentFile() {
  if (!selectedFile) {
    showToast('error', '下载失败', '没有选中的文件');
    return;
  }

  const isDir = selectedFile.type === 'directory';
  const result = await ipcRenderer.invoke('select-save-path', {
    defaultName: selectedFile.name,
    isDir: isDir
  });

  if (result.canceled || !result.path) return;

  // 添加到传输面板
  const taskId = addTransferTask('download', selectedFile.name, selectedFile.path);

  if (isDir) {
    const downloadResult = await ipcRenderer.invoke('ftp-download-dir', {
      configId: selectedConfigId,
      remotePath: selectedFile.path,
      localPath: path.join(result.path, selectedFile.name),
      taskId: taskId
    });
    if (downloadResult.success) {
      completeTransferTask(taskId, true);
      showToast('success', '下载成功', '文件夹已下载');
    } else {
      completeTransferTask(taskId, false, downloadResult.error);
      showToast('error', '下载失败', downloadResult.error);
    }
  } else {
    const downloadResult = await ipcRenderer.invoke('ftp-download', {
      configId: selectedConfigId,
      remotePath: selectedFile.path,
      localPath: result.path,
      taskId: taskId
    });
    if (downloadResult.success) {
      completeTransferTask(taskId, true);
      showToast('success', '下载成功', '文件已下载');
    } else {
      completeTransferTask(taskId, false, downloadResult.error);
      showToast('error', '下载失败', downloadResult.error);
    }
  }
}

// 删除当前文件
async function deleteCurrentFile() {
  if (!selectedFile) {
    showToast('error', '删除失败', '没有选中的文件');
    return;
  }

  const isDir = selectedFile.type === 'directory';
  const typeText = isDir ? '文件夹' : '文件';
  
  const confirmed = await showConfirm('确认删除', `确定要删除${typeText} "${selectedFile.name}" 吗？此操作无法撤销。`);
  if (!confirmed) return;

  const result = await ipcRenderer.invoke('ftp-delete', {
    configId: selectedConfigId,
    remotePath: selectedFile.path,
    isDir: isDir
  });

  if (result.success) {
    selectedFile = null;
    document.getElementById('fileEditor').style.display = 'none';
    document.getElementById('fileEditorEmpty').style.display = 'flex';
    await refreshFileTree();
  } else {
    showToast('error', '删除失败', result.error);
  }
}

// 刷新文件树
async function refreshFileTree() {
  await navigateToDir(currentRemotePath);
}

// 创建远程目录
async function createRemoteDir() {
  const dirName = prompt('请输入文件夹名称:');
  if (!dirName || !dirName.trim()) return;

  const newPath = path.posix.join(currentRemotePath, dirName.trim());
  
  const result = await ipcRenderer.invoke('ftp-create-dir', {
    configId: selectedConfigId,
    remotePath: newPath
  });

  if (result.success) {
    showToast('success', '创建成功', '文件夹已创建');
    await refreshFileTree();
  } else {
    showToast('error', '创建失败', result.error);
  }
}

// ==================== 右键菜单 ====================

function setupContextMenu() {
  // 点击其他地方关闭菜单
  document.addEventListener('click', () => {
    hideContextMenu();
  });
  
  // 在文件树空白区域右键
  const fileTreeContent = document.getElementById('fileTreeContent');
  if (fileTreeContent) {
    fileTreeContent.addEventListener('contextmenu', (event) => {
      // 如果点击的是文件/文件夹项，不处理（由 showContextMenu 处理）
      if (event.target.closest('.tree-item')) {
        return;
      }
      
      event.preventDefault();
      event.stopPropagation();
      
      // 设置为当前目录
      contextMenuTarget = {
        path: currentRemotePath,
        type: 'directory',
        name: path.posix.basename(currentRemotePath) || '/'
      };
      
      showContextMenuAt(event.clientX, event.clientY);
    });
  }
}

function showContextMenu(event, element) {
  event.preventDefault();
  event.stopPropagation();

  contextMenuTarget = {
    path: element.dataset.path,
    type: element.dataset.type,
    name: element.dataset.name
  };

  showContextMenuAt(event.clientX, event.clientY);
}

function showContextMenuAt(x, y) {
  const menu = document.getElementById('contextMenu');
  
  // 确保菜单不超出屏幕
  const menuWidth = 160;
  const menuHeight = 200;
  
  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 10;
  }
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 10;
  }
  
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('show');
  
  lucide.createIcons();
}

function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  menu.classList.remove('show');
}

async function contextMenuAction(action) {
  hideContextMenu();
  
  if (!contextMenuTarget) return;

  switch (action) {
    case 'open':
      if (contextMenuTarget.type === 'directory') {
        await navigateToDir(contextMenuTarget.path);
      } else {
        await loadFileContent(contextMenuTarget.path, contextMenuTarget.name);
      }
      break;

    case 'download':
      selectedFile = contextMenuTarget;
      await downloadCurrentFile();
      break;

    case 'rename':
      const newName = prompt('请输入新名称:', contextMenuTarget.name);
      if (!newName || newName === contextMenuTarget.name) return;
      
      const oldPath = contextMenuTarget.path;
      const newPath = path.posix.join(path.posix.dirname(oldPath), newName);
      
      const renameResult = await ipcRenderer.invoke('ftp-rename', {
        configId: selectedConfigId,
        oldPath: oldPath,
        newPath: newPath
      });
      
      if (renameResult.success) {
        showToast('success', '重命名成功', '');
        await refreshFileTree();
      } else {
        showToast('error', '重命名失败', renameResult.error);
      }
      break;

    case 'newFolder':
      await createRemoteDirAt(contextMenuTarget);
      break;

    case 'newFile':
      await createRemoteFileAt(contextMenuTarget);
      break;

    case 'copy':
      copyToClipboard(contextMenuTarget);
      break;

    case 'cut':
      cutToClipboard(contextMenuTarget);
      break;

    case 'paste':
      await pasteFromClipboard(contextMenuTarget);
      break;

    case 'delete':
      selectedFile = contextMenuTarget;
      await deleteCurrentFile();
      break;
  }
}

// 复制到剪贴板
function copyToClipboard(target) {
  if (!target) return;
  
  clipboard = {
    items: [{ path: target.path, name: target.name, type: target.type }],
    operation: 'copy'
  };
  
  showToast('info', '已复制', `${target.name} 已复制到剪贴板`);
}

// 剪切到剪贴板
function cutToClipboard(target) {
  if (!target) return;
  
  clipboard = {
    items: [{ path: target.path, name: target.name, type: target.type }],
    operation: 'cut'
  };
  
  showToast('info', '已剪切', `${target.name} 已剪切到剪贴板`);
}

// 从剪贴板粘贴
async function pasteFromClipboard(target) {
  if (!clipboard.items || clipboard.items.length === 0) {
    showToast('info', '提示', '剪贴板为空');
    return;
  }
  
  // 确定目标目录
  let targetDir = currentRemotePath;
  if (target) {
    if (target.type === 'directory') {
      targetDir = target.path;
    } else {
      targetDir = path.posix.dirname(target.path);
    }
  }
  
  let successCount = 0;
  let failCount = 0;
  
  for (const item of clipboard.items) {
    const newPath = path.posix.join(targetDir, item.name);
    
    // 检查是否粘贴到自身或子目录
    if (item.path === newPath) {
      showToast('error', '粘贴失败', '不能粘贴到相同位置');
      continue;
    }
    
    if (newPath.startsWith(item.path + '/')) {
      showToast('error', '粘贴失败', '不能将文件夹粘贴到其子目录');
      continue;
    }
    
    if (clipboard.operation === 'copy') {
      // 复制操作
      const result = await ipcRenderer.invoke('ftp-copy', {
        configId: selectedConfigId,
        sourcePath: item.path,
        targetPath: newPath,
        isDir: item.type === 'directory'
      });
      
      if (result.success) {
        successCount++;
      } else {
        failCount++;
        showToast('error', '复制失败', result.error);
      }
    } else if (clipboard.operation === 'cut') {
      // 剪切操作（移动）
      const result = await ipcRenderer.invoke('ftp-rename', {
        configId: selectedConfigId,
        oldPath: item.path,
        newPath: newPath
      });
      
      if (result.success) {
        successCount++;
      } else {
        failCount++;
        showToast('error', '移动失败', result.error);
      }
    }
  }
  
  // 剪切完成后清空剪贴板
  if (clipboard.operation === 'cut' && successCount > 0) {
    clipboard = { items: [], operation: null };
  }
  
  if (successCount > 0) {
    const actionText = clipboard.operation === 'copy' ? '复制' : '移动';
    showToast('success', `${actionText}成功`, `${successCount} 个项目已${actionText}`);
    await refreshFileTree();
  }
}

// 在指定位置创建文件夹
async function createRemoteDirAt(target) {
  // 确定父目录
  let parentPath = currentRemotePath;
  if (target) {
    if (target.type === 'directory') {
      parentPath = target.path;
    } else {
      parentPath = path.posix.dirname(target.path);
    }
  }
  
  // 先用临时名称创建
  const tempName = `新建文件夹_${Date.now()}`;
  const tempPath = path.posix.join(parentPath, tempName);
  
  const result = await ipcRenderer.invoke('ftp-create-dir', {
    configId: selectedConfigId,
    remotePath: tempPath
  });
  
  if (result.success) {
    await refreshFileTree();
    
    // 展开父目录（如果不是根目录）
    if (parentPath !== '/') {
      expandedDirs.add(parentPath);
    }
    
    // 触发重命名
    setTimeout(() => {
      triggerInlineRename(tempPath, tempName, 'directory');
    }, 100);
  } else {
    showToast('error', '创建失败', result.error);
  }
}

// 在指定位置创建文件
async function createRemoteFileAt(target) {
  // 确定父目录
  let parentPath = currentRemotePath;
  if (target) {
    if (target.type === 'directory') {
      parentPath = target.path;
    } else {
      parentPath = path.posix.dirname(target.path);
    }
  }
  
  // 先用临时名称创建
  const tempName = `新建文件_${Date.now()}`;
  const tempPath = path.posix.join(parentPath, tempName);
  
  const result = await ipcRenderer.invoke('ftp-create-file', {
    configId: selectedConfigId,
    remotePath: tempPath,
    content: ''
  });
  
  if (result.success) {
    await refreshFileTree();
    
    // 展开父目录（如果不是根目录）
    if (parentPath !== '/') {
      expandedDirs.add(parentPath);
    }
    
    // 触发重命名
    setTimeout(() => {
      triggerInlineRename(tempPath, tempName, 'file');
    }, 100);
  } else {
    showToast('error', '创建失败', result.error);
  }
}

// 触发内联重命名
function triggerInlineRename(filePath, fileName, fileType) {
  // 找到对应的树节点
  const treeItem = document.querySelector(`.tree-item[data-path="${filePath}"]`);
  if (!treeItem) return;
  
  // 滚动到可见区域
  treeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
  
  // 获取名称元素
  const nameSpan = treeItem.querySelector('.tree-item-name');
  if (!nameSpan) return;
  
  // 保存原始内容
  const originalName = fileName;
  const originalPath = filePath;
  
  // 创建输入框
  const input = document.createElement('input');
  input.type = 'text';
  input.value = fileName;
  input.className = 'inline-rename-input';
  input.style.cssText = `
    background: #1a1a1a;
    border: 1px solid #4a90d9;
    border-radius: 3px;
    color: #e0e0e0;
    font-size: 12px;
    padding: 2px 6px;
    width: 100%;
    outline: none;
  `;
  
  // 替换名称为输入框
  nameSpan.style.display = 'none';
  nameSpan.parentNode.insertBefore(input, nameSpan.nextSibling);
  
  // 选中文件名（不包含扩展名）
  input.focus();
  if (fileType === 'file') {
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex > 0) {
      input.setSelectionRange(0, dotIndex);
    } else {
      input.select();
    }
  } else {
    input.select();
  }
  
  // 处理完成重命名
  const finishRename = async (newName) => {
    // 移除输入框，恢复名称显示
    input.remove();
    nameSpan.style.display = '';
    
    if (!newName || newName === originalName) {
      // 如果没有改名或取消，删除临时创建的文件/文件夹
      if (originalName.startsWith('新建文件夹_') || originalName.startsWith('新建文件_')) {
        await ipcRenderer.invoke('ftp-delete', {
          configId: selectedConfigId,
          remotePath: originalPath,
          isDir: fileType === 'directory'
        });
        await refreshFileTree();
      }
      return;
    }
    
    // 执行重命名
    const newPath = path.posix.join(path.posix.dirname(originalPath), newName);
    
    const renameResult = await ipcRenderer.invoke('ftp-rename', {
      configId: selectedConfigId,
      oldPath: originalPath,
      newPath: newPath
    });
    
    if (renameResult.success) {
      await refreshFileTree();
      
      // 如果是文件，自动打开（先重置修改状态避免弹出确认框）
      if (fileType === 'file') {
        isFileModified = false;
        await loadFileContent(newPath, newName);
      }
    } else {
      showToast('error', '创建失败', renameResult.error);
      await refreshFileTree();
    }
  };
  
  // 绑定事件
  input.addEventListener('blur', () => {
    finishRename(input.value.trim());
  });
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = ''; // 清空表示取消
      input.blur();
    }
  });
}

// ==================== 拖拽上传 ====================

function setupDragAndDrop() {
  const dropZone = document.getElementById('uploadDropZone');
  const fileTree = document.getElementById('fileTreeContent');
  const fileManager = document.getElementById('fileManager');

  // 只在文件管理区域阻止默认拖拽行为，不影响窗口拖动
  if (fileManager) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      fileManager.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
  }

  // 拖拽区域
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
      dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', async (e) => {
      dropZone.classList.remove('drag-over');
      await handleFileDrop(e.dataTransfer.files);
    });

    dropZone.addEventListener('click', async () => {
      await selectAndUploadFiles();
    });
  }

  // 文件树拖拽
  if (fileTree) {
    fileTree.addEventListener('dragover', (e) => {
      const target = e.target.closest('.tree-item');
      if (target && target.dataset.type === 'directory') {
        target.classList.add('drag-over');
      }
    });

    fileTree.addEventListener('dragleave', (e) => {
      const target = e.target.closest('.tree-item');
      if (target) {
        target.classList.remove('drag-over');
      }
    });

    fileTree.addEventListener('drop', async (e) => {
      const target = e.target.closest('.tree-item');
      let targetPath = currentRemotePath;
      
      if (target) {
        target.classList.remove('drag-over');
        if (target.dataset.type === 'directory') {
          targetPath = target.dataset.path;
        }
      }

      await handleFileDrop(e.dataTransfer.files, targetPath);
    });
  }
}

// 处理文件拖拽上传
async function handleFileDrop(files, targetPath) {
  if (!selectedConfigId || files.length === 0) return;

  targetPath = targetPath || currentRemotePath;
  
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const remotePath = path.posix.join(targetPath, file.name);
    
    // 检查是否是文件夹（通过 path 属性）
    if (file.path) {
      const fs = require('fs');
      const stats = fs.statSync(file.path);
      
      // 添加到传输面板
      const taskId = addTransferTask('upload', file.name, remotePath);
      
      if (stats.isDirectory()) {
        const result = await ipcRenderer.invoke('ftp-upload-dir', {
          configId: selectedConfigId,
          localPath: file.path,
          remotePath: remotePath,
          taskId: taskId
        });
        if (result.success) {
          successCount++;
          completeTransferTask(taskId, true);
        } else {
          failCount++;
          completeTransferTask(taskId, false, result.error);
        }
      } else {
        const result = await ipcRenderer.invoke('ftp-upload', {
          configId: selectedConfigId,
          localPath: file.path,
          remotePath: remotePath,
          taskId: taskId
        });
        if (result.success) {
          successCount++;
          completeTransferTask(taskId, true);
        } else {
          failCount++;
          completeTransferTask(taskId, false, result.error);
        }
      }
    }
  }
  
  if (successCount > 0) {
    showToast('success', '上传完成', `成功 ${successCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}`);
    await refreshFileTree();
  } else if (failCount > 0) {
    showToast('error', '上传失败', `${failCount} 个文件上传失败`);
  }
}

// 选择并上传文件
async function selectAndUploadFiles() {
  const result = await ipcRenderer.invoke('select-upload-files');
  if (result.canceled || !result.paths || result.paths.length === 0) return;
  
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < result.paths.length; i++) {
    const localPath = result.paths[i];
    const fileName = path.basename(localPath);
    const remotePath = path.posix.join(currentRemotePath, fileName);
    
    // 添加到传输面板
    const taskId = addTransferTask('upload', fileName, remotePath);
    
    const uploadResult = await ipcRenderer.invoke('ftp-upload', {
      configId: selectedConfigId,
      localPath: localPath,
      remotePath: remotePath,
      taskId: taskId
    });
    
    if (uploadResult.success) {
      successCount++;
      completeTransferTask(taskId, true);
    } else {
      failCount++;
      completeTransferTask(taskId, false, uploadResult.error);
    }
  }
  
  if (successCount > 0) {
    showToast('success', '上传完成', `成功 ${successCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}`);
    await refreshFileTree();
  } else if (failCount > 0) {
    showToast('error', '上传失败', `${failCount} 个文件上传失败`);
  }
}

// ==================== 拖拽下载到本地 ====================

// 处理文件拖拽开始（从FTP拖到本地）
async function handleDragStart(event, element) {
  const filePath = element.dataset.path;
  const fileType = element.dataset.type;
  const fileName = element.dataset.name;

  if (!selectedConfigId) {
    event.preventDefault();
    return;
  }

  // 文件夹暂不支持拖拽下载
  if (fileType === 'directory') {
    event.dataTransfer.effectAllowed = 'none';
    showToast('info', '提示', '文件夹请使用右键菜单下载');
    return;
  }

  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', fileName);

  // 添加到传输面板
  const taskId = addTransferTask('download', fileName, filePath);

  // 异步下载文件到临时目录，然后启动系统拖拽
  try {
    const result = await ipcRenderer.invoke('prepare-drag-download', {
      configId: selectedConfigId,
      remotePath: filePath,
      fileName: fileName,
      taskId: taskId
    });

    if (result.success) {
      completeTransferTask(taskId, true);
      // 启动系统拖拽
      ipcRenderer.send('start-drag', result.tempPath);
    } else {
      completeTransferTask(taskId, false, result.error);
      showToast('error', '拖拽下载失败', result.error);
    }
  } catch (error) {
    completeTransferTask(taskId, false, error.message);
    showToast('error', '拖拽下载失败', error.message);
  }
}

// ==================== 上传进度 ====================

function showUploadProgress() {
  document.getElementById('uploadProgress').classList.add('show');
  lucide.createIcons();
}

function hideUploadProgress() {
  document.getElementById('uploadProgress').classList.remove('show');
}

function updateUploadProgress(fileName, percent) {
  document.getElementById('uploadProgressFile').textContent = fileName;
  document.getElementById('uploadProgressPercent').textContent = percent + '%';
  document.getElementById('uploadProgressFill').style.width = percent + '%';
}

// ==================== 日志折叠 ====================

function toggleLogs() {
  const container = document.getElementById('logsContainer');
  const btn = document.getElementById('logsToggleBtn');
  
  isLogsCollapsed = !isLogsCollapsed;
  
  if (isLogsCollapsed) {
    // 保存当前高度用于恢复
    if (!container.dataset.lastHeight) {
      container.dataset.lastHeight = container.offsetHeight + 'px';
    }
    container.style.height = '40px';
    container.classList.add('collapsed');
    btn.innerHTML = '<i data-lucide="chevron-up"></i><span>展开</span>';
  } else {
    // 恢复之前的高度
    const lastHeight = container.dataset.lastHeight || '200px';
    container.style.height = lastHeight;
    container.classList.remove('collapsed');
    btn.innerHTML = '<i data-lucide="chevron-down"></i><span>折叠</span>';
  }
  
  lucide.createIcons();
}

// 日志分隔条拖拽（垂直）
function setupLogsResizer() {
  const resizer = document.getElementById('logsResizer');
  const logsContainer = document.getElementById('logsContainer');
  
  if (!resizer || !logsContainer) return;

  let startY, startHeight;

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startY = e.clientY;
    startHeight = logsContainer.offsetHeight;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    const delta = startY - e.clientY;
    const newHeight = Math.max(40, Math.min(500, startHeight + delta));
    logsContainer.style.height = newHeight + 'px';
    
    // 更新折叠按钮状态
    const btn = document.getElementById('logsToggleBtn');
    if (newHeight <= 40) {
      isLogsCollapsed = true;
      logsContainer.classList.add('collapsed');
      if (btn) btn.innerHTML = '<i data-lucide="chevron-up"></i><span>展开</span>';
    } else {
      isLogsCollapsed = false;
      logsContainer.classList.remove('collapsed');
      if (btn) btn.innerHTML = '<i data-lucide="chevron-down"></i><span>折叠</span>';
      // 保存非折叠状态的高度
      logsContainer.dataset.lastHeight = newHeight + 'px';
    }
  }

  function onMouseUp() {
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    lucide.createIcons();
  }
}

// 文件树分隔条拖拽（水平）
function setupTreeResizer() {
  const resizer = document.getElementById('treeEditorResizer');
  const fileTree = document.getElementById('fileTree');
  
  if (!resizer || !fileTree) return;

  let startX, startWidth;

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = fileTree.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    const delta = e.clientX - startX;
    const newWidth = Math.max(150, Math.min(500, startWidth + delta));
    fileTree.style.width = newWidth + 'px';
  }

  function onMouseUp() {
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    
    // 刷新 CodeMirror 编辑器
    if (codeEditor) {
      setTimeout(() => codeEditor.refresh(), 10);
    }
  }
}

// 侧边栏分隔条拖拽
function setupSidebarResizer() {
  const resizer = document.getElementById('sidebarResizer');
  const sidebar = document.getElementById('sidebar');
  
  if (!resizer || !sidebar) return;

  let startX, startWidth;

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    const delta = e.clientX - startX;
    const newWidth = Math.max(200, Math.min(500, startWidth + delta));
    sidebar.style.width = newWidth + 'px';
  }

  function onMouseUp() {
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
}

// ==================== 快捷键 ====================

function setupKeyboardShortcuts() {
  // 全局快捷键监听
  document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isInEditor = activeEl && (activeEl.classList.contains('CodeMirror-code') || activeEl.closest('.CodeMirror'));
    const isInInput = activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT');
    
    // Ctrl/Cmd + S 保存（支持 Windows Ctrl+S 和 macOS Cmd+S）
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      e.stopPropagation();
      if (selectedFile && selectedFile.type === 'file' && selectedConfigId) {
        saveCurrentFile();
      }
      return false;
    }
    
    // Ctrl/Cmd + C 复制（不在编辑器/输入框中时）
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !isInEditor && !isInInput) {
      if (selectedFile && selectedConfigId) {
        e.preventDefault();
        copyToClipboard(selectedFile);
      }
    }
    
    // Ctrl/Cmd + X 剪切（不在编辑器/输入框中时）
    if ((e.ctrlKey || e.metaKey) && e.key === 'x' && !isInEditor && !isInInput) {
      if (selectedFile && selectedConfigId) {
        e.preventDefault();
        cutToClipboard(selectedFile);
      }
    }
    
    // Ctrl/Cmd + V 粘贴（不在编辑器/输入框中时）
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isInEditor && !isInInput) {
      if (selectedConfigId && clipboard.items.length > 0) {
        e.preventDefault();
        pasteFromClipboard(selectedFile);
      }
    }
    
    // Delete 删除（不在编辑器中时）
    if (e.key === 'Delete' || (e.metaKey && e.key === 'Backspace')) {
      if (selectedFile && !isInEditor && !isInInput) {
        e.preventDefault();
        deleteCurrentFile();
      }
    }
    
    // F5 刷新
    if (e.key === 'F5') {
      e.preventDefault();
      refreshFileTree();
    }
    
    // F11 全屏编辑器
    if (e.key === 'F11') {
      e.preventDefault();
      if (selectedFile && selectedFile.type === 'file') {
        toggleEditorFullscreen();
      }
    }
    
    // ESC 退出全屏
    if (e.key === 'Escape') {
      if (isEditorFullscreen) {
        e.preventDefault();
        exitEditorFullscreen();
      }
    }
  }, true); // 使用捕获阶段确保优先处理
}

// ==================== 传输进度面板 ====================

// 添加传输任务
function addTransferTask(type, fileName, filePath) {
  const task = {
    id: ++transferIdCounter,
    type, // 'upload' | 'download'
    fileName,
    filePath,
    progress: 0,
    speed: '',
    status: 'pending', // 'pending' | 'transferring' | 'success' | 'error'
    startTime: Date.now(),
    error: null
  };
  
  transferTasks.unshift(task);
  
  // 自动打开面板
  openTransferPanel();
  renderTransferPanel();
  
  return task.id;
}

// 更新传输进度
function updateTransferProgress(taskId, progress, speed) {
  const task = transferTasks.find(t => t.id === taskId);
  if (task) {
    task.progress = progress;
    task.speed = speed || '';
    task.status = 'transferring';
    renderTransferPanel();
  }
}

// 完成传输任务
function completeTransferTask(taskId, success, error = null) {
  const task = transferTasks.find(t => t.id === taskId);
  if (task) {
    task.progress = success ? 100 : task.progress;
    task.status = success ? 'success' : 'error';
    task.error = error;
    task.endTime = Date.now();
    renderTransferPanel();
    
    // 检查是否所有任务都已完成，如果是则自动最小化
    checkAutoMinimize();
  }
}

// 检查是否需要自动最小化
function checkAutoMinimize() {
  const activeCount = transferTasks.filter(t => t.status === 'pending' || t.status === 'transferring').length;
  
  // 如果没有活动任务且面板是打开的，延迟后自动最小化
  if (activeCount === 0 && isTransferPanelOpen && transferTasks.length > 0) {
    setTimeout(() => {
      // 再次检查，确保没有新任务
      const stillActive = transferTasks.filter(t => t.status === 'pending' || t.status === 'transferring').length;
      if (stillActive === 0 && isTransferPanelOpen) {
        closeTransferPanel();
      }
    }, 1500); // 1.5秒后自动最小化
  }
}

// 渲染传输面板
function renderTransferPanel() {
  const content = document.getElementById('transferContent');
  const badge = document.getElementById('transferBadge');
  const fabBadge = document.getElementById('transferFabBadge');
  
  // 计算活动任务数
  const activeCount = transferTasks.filter(t => t.status === 'pending' || t.status === 'transferring').length;
  
  badge.textContent = activeCount;
  badge.style.display = activeCount > 0 ? 'inline' : 'none';
  
  if (fabBadge) {
    fabBadge.textContent = activeCount;
    fabBadge.style.display = activeCount > 0 ? 'flex' : 'none';
  }
  
  if (transferTasks.length === 0) {
    content.innerHTML = `
      <div class="transfer-panel-empty">
        <i data-lucide="inbox"></i>
        <div>暂无传输任务</div>
      </div>
    `;
    lucide.createIcons();
    return;
  }
  
  content.innerHTML = transferTasks.slice(0, 50).map(task => {
    const icon = task.type === 'upload' ? 'upload' : 'download';
    const statusText = getStatusText(task);
    const statusClass = task.status;
    const progressClass = task.type;
    
    // 格式化时间显示
    const startTimeStr = formatTaskTime(task.startTime);
    const endTimeStr = task.endTime ? formatTaskTime(task.endTime) : '';
    
    let infoText = '';
    if (task.status === 'transferring' && task.speed) {
      infoText = task.speed;
    } else if (task.status === 'success' && task.endTime) {
      const duration = ((task.endTime - task.startTime) / 1000).toFixed(1);
      infoText = `耗时 ${duration}s`;
    } else if (task.status === 'error' && task.error) {
      infoText = task.error;
    }
    
    return `
      <div class="transfer-item">
        <div class="transfer-item-header">
          <div class="transfer-item-name ${task.type}">
            <i data-lucide="${icon}"></i>
            <span title="${task.filePath}">${task.fileName}</span>
          </div>
          <span class="transfer-item-status ${statusClass}">${statusText}</span>
        </div>
        <div class="transfer-item-time">
          <span>${startTimeStr}</span>
          ${endTimeStr ? `<span>- ${endTimeStr}</span>` : ''}
        </div>
        ${task.status === 'transferring' || task.status === 'pending' ? `
          <div class="transfer-item-progress">
            <div class="transfer-item-progress-fill ${progressClass}" style="width: ${task.progress}%"></div>
          </div>
        ` : ''}
        ${infoText ? `<div class="transfer-item-info"><span>${infoText}</span><span>${task.progress}%</span></div>` : ''}
      </div>
    `;
  }).join('');
  
  lucide.createIcons();
}

// 获取状态文本
function getStatusText(task) {
  switch (task.status) {
    case 'pending': return '等待中';
    case 'transferring': return `${task.progress}%`;
    case 'success': return '完成';
    case 'error': return '失败';
    default: return '';
  }
}

// 打开传输面板
function openTransferPanel() {
  const panel = document.getElementById('transferPanel');
  const fab = document.getElementById('transferFab');
  
  panel.classList.add('show');
  fab.classList.remove('show');
  isTransferPanelOpen = true;
  
  lucide.createIcons();
}

// 关闭传输面板
function closeTransferPanel() {
  const panel = document.getElementById('transferPanel');
  const fab = document.getElementById('transferFab');
  
  panel.classList.remove('show');
  
  // 如果有任务，显示悬浮按钮
  if (transferTasks.length > 0) {
    fab.classList.add('show');
  }
  
  isTransferPanelOpen = false;
  lucide.createIcons();
}

// 切换传输面板（最小化/展开）
function toggleTransferPanel() {
  const panel = document.getElementById('transferPanel');
  panel.classList.toggle('minimized');
}

// 清除已完成的传输
function clearCompletedTransfers() {
  transferTasks = transferTasks.filter(t => t.status === 'pending' || t.status === 'transferring');
  renderTransferPanel();
  
  // 如果没有任务了，隐藏悬浮按钮
  if (transferTasks.length === 0) {
    document.getElementById('transferFab').classList.remove('show');
  }
}

// 格式化速度
function formatSpeed(bytesPerSecond) {
  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond.toFixed(0)} B/s`;
  } else if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  } else {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  }
}

// 格式化任务时间（显示时:分:秒）
function formatTaskTime(timestamp) {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
