const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  // 只在生产构建时运行
  if (context.electronPlatformName === 'darwin') {
    const asarPath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
      'app.asar'
    );
    
    if (fs.existsSync(asarPath)) {
      console.log('Applying asarmor protection to:', asarPath);
      
      return new Promise((resolve, reject) => {
        exec(`npx asarmor -a "${asarPath}"`, (error, stdout, stderr) => {
          if (error) {
            console.warn('asarmor warning:', error.message);
            // 不阻止构建继续
            resolve();
          } else {
            console.log('asarmor applied successfully');
            resolve();
          }
        });
      });
    }
  } else if (context.electronPlatformName === 'win32') {
    const asarPath = path.join(
      context.appOutDir,
      'resources',
      'app.asar'
    );
    
    if (fs.existsSync(asarPath)) {
      console.log('Applying asarmor protection to:', asarPath);
      
      return new Promise((resolve, reject) => {
        exec(`npx asarmor -a "${asarPath}"`, (error, stdout, stderr) => {
          if (error) {
            console.warn('asarmor warning:', error.message);
            resolve();
          } else {
            console.log('asarmor applied successfully');
            resolve();
          }
        });
      });
    }
  }
};
