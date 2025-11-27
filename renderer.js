const { ipcRenderer } = require('electron');

let configs = [];
let currentEditId = null;
let logs = {};
let selectedConfigId = null;

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
  
  list.innerHTML = configs.map(config => `
    <div class="config-item ${selectedConfigId === config.id ? 'active' : ''}" data-id="${config.id}" onclick="selectConfig('${config.id}')" ondblclick="editConfig('${config.id}')">
      <div class="config-header">
        <div class="config-name">${config.name}</div>
        <div class="config-status">
          <div class="status-dot ${config.enabled ? 'active' : ''}"></div>
          <span style="font-size: 11px; color: #999;">${config.enabled ? '运行中' : '已停止'}</span>
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
        <button class="btn-small btn-toggle ${config.enabled ? '' : 'disabled'}" onclick="event.stopPropagation(); toggleConfig('${config.id}', ${!config.enabled})">
          ${config.enabled ? '停止' : '启动'}
        </button>
        <button class="btn-small btn-test-config" onclick="event.stopPropagation(); testConfigConnection('${config.id}', event)">测试</button>
        <button class="btn-small btn-edit" onclick="event.stopPropagation(); editConfig('${config.id}')">编辑</button>
        <button class="btn-small btn-delete" onclick="event.stopPropagation(); deleteConfig('${config.id}')">删除</button>
      </div>
    </div>
  `).join('');
  
  // Re-initialize Lucide icons for newly added elements
  lucide.createIcons();
}

function renderLogs() {
  const container = document.getElementById('logsContainer');
  
  // 如果没有选中的配置，显示提示
  if (!selectedConfigId) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <i data-lucide="file-text"></i>
        </div>
        <div class="empty-state-text">实时日志</div>
        <div class="empty-state-subtext">点击左侧配置查看日志</div>
      </div>
    `;
    lucide.createIcons();
    return;
  }
  
  // 查找选中的配置
  const selectedConfig = configs.find(c => c.id === selectedConfigId);
  if (!selectedConfig) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <i data-lucide="file-text"></i>
        </div>
        <div class="empty-state-text">配置不存在</div>
      </div>
    `;
    lucide.createIcons();
    return;
  }
  
  const configLogs = logs[selectedConfigId] || [];
  
  // 显示选中配置的日志
  container.innerHTML = `
    <div class="log-group">
      <div class="log-group-header">
        <div class="log-group-header-left">
          <i data-lucide="activity"></i>
          <span>${selectedConfig.name}</span>
          <span style="color: #666; font-size: 12px; font-weight: normal;">(${configLogs.length} 条日志)</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="log-copy-btn" onclick="clearLogs('${selectedConfigId}', event)">
            <i data-lucide="trash-2"></i>
            <span>清除</span>
          </button>
          <button class="log-copy-btn" onclick="copyLogs('${selectedConfigId}', event)">
            <i data-lucide="copy"></i>
            <span>复制</span>
          </button>
        </div>
      </div>
      <div class="log-entries">
        ${configLogs.length > 0 ? configLogs.slice(-100).reverse().map(log => `
          <div class="log-entry ${log.type}">
            <span class="log-time">${formatTime(log.timestamp)}</span>
            <span class="log-message">${log.message}</span>
          </div>
        `).join('') : '<div style="padding: 20px; text-align: center; color: #666;">暂无日志</div>'}
      </div>
    </div>
  `;
  
  // Re-initialize Lucide icons for newly added elements
  lucide.createIcons();
  
  // Auto scroll to bottom
  setTimeout(() => {
    const logEntries = document.querySelector('.log-entries');
    if (logEntries) {
      logEntries.scrollTop = logEntries.scrollHeight;
    }
  }, 0);
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

function selectConfig(configId) {
  selectedConfigId = configId;
  renderConfigList();
  renderLogs();
}

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

function showAddModal() {
  currentEditId = null;
  document.getElementById('modalTitle').textContent = '添加 FTP 配置';
  document.getElementById('configForm').reset();
  document.getElementById('ftpPort').value = '21';
  document.getElementById('remotePath').value = '/';
  document.getElementById('uploadNew').checked = true;
  document.getElementById('configModal').classList.add('show');
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
    uploadNew: document.getElementById('uploadNew').checked
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
  document.getElementById('configModal').classList.add('show');
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
      document.removeEventListener('keydown', handleEscape);
    };
    
    // ESC 键关闭
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    
    // 绑定事件
    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleEscape);
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
  setupAutoTrim();
});

// Initialize
loadConfigs();
