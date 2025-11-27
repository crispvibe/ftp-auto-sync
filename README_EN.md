# FTP Auto Sync

<div align="center">

<img src="ftp.png" alt="FTP Auto Sync" width="120" />

A modern cross-platform desktop application for monitoring local directories and automatically uploading modified files to multiple FTP servers.

[![GitHub](https://img.shields.io/badge/GitHub-Open%20Source-blue?logo=github)](https://github.com/crispvibe/ftp-auto-sync)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](https://github.com/crispvibe/ftp-auto-sync/releases)
[![Electron](https://img.shields.io/badge/Electron-27.0.0-blue.svg)](https://www.electronjs.org/)

[中文文档](README.md) | English

</div>

## Features

- **Multiple FTP Configurations** - Manage multiple FTP server configurations simultaneously
- **Real-time File Monitoring** - Automatically detect file changes and upload
- **Auto Upload** - Files are automatically uploaded to FTP server after saving
- **Grouped Logs** - Independent real-time log display for each FTP configuration
- **Toggle Control** - Independent start/stop control for each FTP connection
- **Modern UI** - Beautiful dark theme interface
- **Secure Connection** - Support for FTPS encrypted transmission
- **High Performance** - Built with Electron and Chokidar
- **Cross-platform** - Support for macOS (Intel & Apple Silicon) and Windows (x64 & ARM64)
- **Smart Validation** - Auto-test FTP connection before starting, avoid invalid configurations
- **Auto Retry** - Automatic retry on upload failure with exponential backoff strategy
- **Concurrency Control** - Prevent duplicate uploads of the same file, avoid connection conflicts
- **Auto Trim** - Input fields auto-trim whitespace to avoid configuration errors
- **Quick Actions** - Support double-click to edit, keyboard shortcuts, and more

## Screenshots

![Application Screenshot](截屏2025-11-28%2000.46.05_副本.png)

*Modern dark theme interface with multiple FTP configuration management and real-time log display*

## Quick Start

### Prerequisites

- Node.js 16 or higher
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/crispvibe/ftp-auto-sync.git

# Navigate to directory
cd ftp-auto-sync

# Install dependencies
npm install

# Run in development mode
npm run dev

# Or run in production mode
npm start
```

### Build

```bash
# Build for current platform
npm run build

# Build for macOS
npm run build:mac

# Build for Windows
npm run build:win

# Build for all platforms
npm run build:all
```

Built applications will be in the `dist` directory.

## Usage

### 1. Add FTP Configuration

- Click "Add New Configuration" button in the left sidebar
- Fill in configuration information:
  - **Configuration Name**: A recognizable name for this configuration
  - **Local Monitor Directory**: Select the local folder to monitor
  - **FTP Host**: FTP server address
  - **Port**: FTP port (default 21)
  - **Username**: FTP login username
  - **Password**: FTP login password
  - **Remote Directory**: Target directory on FTP server
  - **Use Secure Connection**: Whether to use FTPS encryption
  - **Upload New Files**: Whether to upload newly created files (default only uploads modified files)

### 2. Test Connection

Before saving configuration, click "Test Connection" button to verify FTP connection.

### 3. Start Monitoring

- After saving configuration, click "Start" button on the configuration card
- Application will start monitoring the specified directory
- Files will be automatically uploaded to FTP server after modification

### 4. View Logs

- Right panel displays real-time logs for all configurations
- Logs are grouped by configuration
- Different log types are color-coded:
  - Blue: Information logs
  - Green: Successful uploads
  - Red: Error messages

### 5. Manage Configurations

- **Edit**: Modify existing configuration
- **Delete**: Remove unwanted configuration
- **Start/Stop**: Control monitoring toggle

## Tech Stack

- **Electron**: Cross-platform desktop application framework
- **Chokidar**: High-performance file system monitoring
- **basic-ftp**: FTP client library
- **Lucide Icons**: Modern icon library

## Project Structure

```
ftp-auto-sync/
├── main.js                 # Electron main process
├── renderer.js             # Renderer process logic
├── index.html              # UI interface
├── package.json            # Project configuration
├── ftp-configs.json        # Configuration file (auto-generated)
├── README.md               # Chinese documentation
├── README_EN.md            # English documentation
├── LICENSE                 # MIT License
├── CONTRIBUTING.md         # Contribution guide
├── CHANGELOG.md            # Change log
├── SECURITY.md             # Security policy
└── .github/                # GitHub configuration
    ├── workflows/          # CI/CD workflows
    └── ISSUE_TEMPLATE/     # Issue templates
```

## Configuration File

Configuration information is saved in `ftp-configs.json` in the application directory.

- **Development**: Configuration file is in project root directory
- **Production**: Configuration file is in application installation directory

Refer to `ftp-configs.example.json` for configuration file format.

### Backup Configuration

You can directly copy the `ftp-configs.json` file for backup or restore configuration on other devices.

## Security

- Configuration information (including passwords) is stored in plain text in `ftp-configs.json`, please keep it safe
- It's recommended to use FTPS secure connection
- Use FTP accounts with minimal permissions
- Regularly change FTP passwords

For more security information, see [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

If this project helps you, please give it a Star!

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

## Links

- **GitHub Repository**: [https://github.com/crispvibe/ftp-auto-sync](https://github.com/crispvibe/ftp-auto-sync)
- **Bug Reports**: [Issues](https://github.com/crispvibe/ftp-auto-sync/issues)
- **Feature Requests**: [Discussions](https://github.com/crispvibe/ftp-auto-sync/discussions)

## Contact

- GitHub: [@crispvibe](https://github.com/crispvibe)
- Email: 99400504@qq.com

---

Made by [crispvibe](https://github.com/crispvibe)
