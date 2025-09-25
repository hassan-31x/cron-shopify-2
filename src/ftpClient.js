const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class FTPClient {
  constructor() {
    this.client = new ftp.Client();
    this.client.ftp.verbose = false; // Set to true for debugging
    this.maxRetries = 10;
    this.retryDelay = 5000; // 5 seconds
  }

  async connect() {
    try {
      // Set timeout configurations
      this.client.timeout = 30000; // 30 seconds timeout
      
      await this.client.access({
        host: process.env.FTP_HOST || 'ftp.qgold.com',
        port: parseInt(process.env.FTP_PORT) || 21,
        user: process.env.FTP_USER || '56001',
        password: process.env.FTP_PASSWORD || 'Qq-56fdT7gwweath',
        secure: false // Set to true if FTPS is required
      });
      
      // Set passive mode (often required for firewalls)
      await this.client.ensureDir('/');
      
      logger.info('Successfully connected to FTP server');
      return true;
    } catch (error) {
      logger.error('Failed to connect to FTP server:', error.message);
      throw error;
    }
  }

  async listFiles(remotePath = '/') {
    try {
      const fileList = await this.client.list(remotePath);
      logger.info(`Found ${fileList.length} files in directory: ${remotePath}`);
      
      // Filter for CSV files
      const csvFiles = fileList.filter(file => 
        file.name.toLowerCase().endsWith('.csv') && file.type === 1
      );
      
      logger.info(`Found ${csvFiles.length} CSV files`);
      return csvFiles;
    } catch (error) {
      logger.error('Failed to list files:', error.message);
      throw error;
    }
  }

  async downloadFile(remoteFilePath, localFilePath) {
    try {
      // Ensure the local directory exists
      const localDir = path.dirname(localFilePath);
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }

      // Create backup of existing file if it exists
      const backupFilePath = `${localFilePath}.backup`;
      if (fs.existsSync(localFilePath)) {
        logger.info(`Creating backup: ${path.basename(localFilePath)} -> ${path.basename(backupFilePath)}`);
        fs.renameSync(localFilePath, backupFilePath);
      }

      logger.info(`Starting download: ${remoteFilePath} -> ${localFilePath}`);
      
      // Set passive mode and timeout for download
      this.client.ftp.pasv = true;
      this.client.timeout = 120000; // 2 minutes for large files
      
      // Get remote file size first for progress tracking
      let remoteFileSize = 0;
      try {
        const fileList = await this.client.list('/');
        const targetFile = fileList.find(file => file.name === remoteFilePath);
        if (targetFile) {
          remoteFileSize = targetFile.size;
          logger.info(`Remote file size: ${(remoteFileSize / (1024 * 1024)).toFixed(2)} MB`);
        }
      } catch (sizeError) {
        logger.warn('Could not get remote file size:', sizeError.message);
      }

      // Download with progress tracking
      await this.downloadWithProgress(remoteFilePath, localFilePath, remoteFileSize);
      
      // Verify download was successful
      if (!fs.existsSync(localFilePath)) {
        throw new Error('Download completed but file not found locally');
      }

      // Get final file size for verification
      const stats = fs.statSync(localFilePath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      // Verify file size if we know the remote size
      if (remoteFileSize > 0 && Math.abs(stats.size - remoteFileSize) > 1024) {
        throw new Error(`File size mismatch: local ${stats.size} bytes, remote ${remoteFileSize} bytes`);
      }
      
      logger.info(`✅ Successfully downloaded file: ${localFilePath} (${fileSizeMB} MB)`);
      
      // Delete backup file only after successful download
      if (fs.existsSync(backupFilePath)) {
        fs.unlinkSync(backupFilePath);
        logger.info(`🗑️ Deleted backup file: ${path.basename(backupFilePath)}`);
      }
      
      return localFilePath;
    } catch (error) {
      logger.error(`❌ Failed to download file ${remoteFilePath}:`, error.message);
      
      // Restore backup if download failed
      const backupFilePath = `${localFilePath}.backup`;
      if (fs.existsSync(backupFilePath)) {
        if (fs.existsSync(localFilePath)) {
          fs.unlinkSync(localFilePath); // Remove partial download
        }
        fs.renameSync(backupFilePath, localFilePath);
        logger.info(`🔄 Restored backup file: ${path.basename(localFilePath)}`);
      } else {
        // Clean up partial download if no backup exists
        if (fs.existsSync(localFilePath)) {
          try {
            fs.unlinkSync(localFilePath);
            logger.info('🧹 Cleaned up partial download');
          } catch (cleanupError) {
            logger.warn('Failed to clean up partial download:', cleanupError.message);
          }
        }
      }
      
      throw error;
    }
  }

  async downloadWithProgress(remoteFilePath, localFilePath, expectedSize = 0) {
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(localFilePath);
      let downloadedBytes = 0;
      let lastProgressTime = Date.now();
      let lastDownloadedBytes = 0;
      const startTime = Date.now();
      let downloadCompleted = false;

      // Progress tracking
      const logProgress = () => {
        const now = Date.now();
        const timeDiff = now - lastProgressTime;
        const bytesDiff = downloadedBytes - lastDownloadedBytes;
        
        if (timeDiff >= 2000) { // Log every 2 seconds
          const speedMBps = (bytesDiff / (1024 * 1024)) / (timeDiff / 1000);
          const progressMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
          
          let progressMsg = `📥 Downloaded: ${progressMB} MB`;
          
          if (expectedSize > 0) {
            const progressPercent = ((downloadedBytes / expectedSize) * 100).toFixed(1);
            const totalMB = (expectedSize / (1024 * 1024)).toFixed(2);
            progressMsg += ` / ${totalMB} MB (${progressPercent}%)`;
            
            // Check if download is complete based on size
            if (downloadedBytes >= expectedSize && !downloadCompleted) {
              downloadCompleted = true;
              const endTime = Date.now();
              const totalTime = ((endTime - startTime) / 1000).toFixed(2);
              const finalSizeMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
              const avgSpeedMBps = (downloadedBytes / (1024 * 1024)) / (totalTime);
              
              logger.info(`🎉 Download completed: ${finalSizeMB} MB in ${totalTime}s (avg: ${avgSpeedMBps.toFixed(2)} MB/s)`);
              writeStream.end();
              clearInterval(progressInterval);
              resolve();
              return;
            }
          }
          
          progressMsg += ` | Speed: ${speedMBps.toFixed(2)} MB/s`;
          
          logger.info(progressMsg);
          
          lastProgressTime = now;
          lastDownloadedBytes = downloadedBytes;
        }
      };

      // Set up the download stream
      this.client.downloadTo(writeStream, remoteFilePath)
        .then(() => {
          if (!downloadCompleted) {
            downloadCompleted = true;
            writeStream.end();
            const endTime = Date.now();
            const totalTime = ((endTime - startTime) / 1000).toFixed(2);
            const finalSizeMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
            const avgSpeedMBps = (downloadedBytes / (1024 * 1024)) / (totalTime);
            
            logger.info(`🎉 Download completed: ${finalSizeMB} MB in ${totalTime}s (avg: ${avgSpeedMBps.toFixed(2)} MB/s)`);
            clearInterval(progressInterval);
            resolve();
          }
        })
        .catch((error) => {
          if (!downloadCompleted) {
            writeStream.destroy();
            logger.error('❌ Download stream error:', error.message);
            clearInterval(progressInterval);
            reject(error);
          }
        });

      // Track progress on the write stream
      writeStream.on('error', (error) => {
        if (!downloadCompleted) {
          logger.error('❌ Write stream error:', error.message);
          clearInterval(progressInterval);
          reject(error);
        }
      });

      // Monitor file size growth for progress
      const progressInterval = setInterval(() => {
        try {
          if (fs.existsSync(localFilePath)) {
            const stats = fs.statSync(localFilePath);
            downloadedBytes = stats.size;
            logProgress();
          }
        } catch (error) {
          // Ignore stat errors during download
        }
      }, 1000); // Check every second

      writeStream.on('close', () => {
        clearInterval(progressInterval);
      });

      writeStream.on('finish', () => {
        if (!downloadCompleted) {
          downloadCompleted = true;
          clearInterval(progressInterval);
          // Final progress log
          if (fs.existsSync(localFilePath)) {
            const stats = fs.statSync(localFilePath);
            downloadedBytes = stats.size;
            const endTime = Date.now();
            const totalTime = ((endTime - startTime) / 1000).toFixed(2);
            const finalSizeMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
            const avgSpeedMBps = (downloadedBytes / (1024 * 1024)) / (totalTime);
            
            logger.info(`🎉 Download completed: ${finalSizeMB} MB in ${totalTime}s (avg: ${avgSpeedMBps.toFixed(2)} MB/s)`);
          }
          resolve();
        }
      });
    });
  }

  async getLatestCSVFile() {
    try {
      const files = await this.listFiles();
      
      if (files.length === 0) {
        throw new Error('No CSV files found on FTP server');
      }

      // Sort by modification date (newest first)
      const sortedFiles = files.sort((a, b) => 
        new Date(b.modifiedAt) - new Date(a.modifiedAt)
      );

      const latestFile = sortedFiles[0];
      logger.info(`Latest CSV file: ${latestFile.name} (modified: ${latestFile.modifiedAt})`);
      
      return latestFile;
    } catch (error) {
      logger.error('Failed to get latest CSV file:', error.message);
      throw error;
    }
  }

  async downloadLatestCSV(localDir = './downloads') {
    let attempt = 0;
    
    while (attempt < this.maxRetries) {
      try {
        attempt++;
        logger.info(`Download attempt ${attempt}/${this.maxRetries}`);
        
        const latestFile = await this.getLatestCSVFile();
        const localFilePath = path.join(localDir, latestFile.name);
        
        return await this.downloadFile(latestFile.name, localFilePath);
        
      } catch (error) {
        logger.error(`Download attempt ${attempt} failed:`, error.message);
        
        if (attempt < this.maxRetries) {
          logger.info(`Retrying in ${this.retryDelay / 1000} seconds...`);
          await this.sleep(this.retryDelay);
          
          // Reconnect for retry
          try {
            await this.close();
            await this.connect();
          } catch (reconnectError) {
            logger.warn('Reconnection failed:', reconnectError.message);
          }
        } else {
          logger.error('All download attempts failed');
          throw error;
        }
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async close() {
    try {
      this.client.close();
      logger.info('FTP connection closed');
    } catch (error) {
      logger.error('Error closing FTP connection:', error.message);
    }
  }
}

module.exports = FTPClient;
