require('dotenv').config();
const cron = require('node-cron');
const FTPClient = require('./ftpClient');
const CSVProcessor = require('./csvProcessor');
const ShopifyClient = require('./shopifyClient');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

class ProductDataCronJob {
  constructor() {
    this.ftpClient = new FTPClient();
    this.csvProcessor = new CSVProcessor();
    this.shopifyClient = new ShopifyClient();
    this.isRunning = false;
    this.downloadDir = process.env.DOWNLOAD_DIR || './downloads';
    this.keepFilesDays = parseInt(process.env.KEEP_FILES_DAYS) || 7;
  }

  async init() {
    // Create download directory if it doesn't exist
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
      logger.info(`Created download directory: ${this.downloadDir}`);
    }

    logger.info('Product Data Cron Job initialized');
    logger.info(`Download directory: ${path.resolve(this.downloadDir)}`);
    logger.info(`Keep files for: ${this.keepFilesDays} days`);
  }

  async executeJob() {
    if (this.isRunning) {
      logger.warn('Job is already running, skipping this execution');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      logger.info('='.repeat(50));
      logger.info('Starting daily product data processing job');
      logger.info('='.repeat(50));

      // Step 1: Connect to FTP server
      await this.ftpClient.connect();

      // Step 2: Download latest CSV file
      const downloadedFile = await this.ftpClient.downloadLatestCSV(this.downloadDir);
      
      // Step 3: Get file information
      const fileInfo = await this.csvProcessor.getFileInfo(downloadedFile);
      logger.info(`File info: ${fileInfo.sizeMB} MB, estimated ${fileInfo.estimatedRows} rows`);

      // Step 4: Process the CSV file
      const result = await this.csvProcessor.processFile(downloadedFile);
      
      // Step 5: Log results and first item
      logger.info('Processing completed successfully');
      logger.info(`Processed ${result.stats.processedRows} products in ${result.stats.duration}s`);
      
      if (result.data.length > 0) {
        logger.info('First product item:', JSON.stringify(result.data[0], null, 2));
      }

      // Step 6: Fetch Shopify products
      logger.info('Fetching products from Shopify...');
      const shopifyProducts = await this.shopifyClient.getAllProducts();
      this.shopifyClient.logProductSummary(shopifyProducts);

      // Step 7: Create products from CSV data
      logger.info('='.repeat(50));
      logger.info('Starting product creation from CSV data...');
      
      const processOptions = {
        batchSize: parseInt(process.env.SHOPIFY_BATCH_SIZE) || 10,
        delayBetweenBatches: parseInt(process.env.SHOPIFY_BATCH_DELAY) || 1000,
        dryRun: process.env.SHOPIFY_DRY_RUN === 'true',
        parallelBatch: process.env.SHOPIFY_PARALLEL_BATCH !== 'false',
        enableUpdates: process.env.SHOPIFY_ENABLE_UPDATES !== 'false' // New option for updates
      };

      logger.info(`Processing options:`, processOptions);
      
      // Use the new method that handles both creation and updates
      const creationResults = await this.shopifyClient.processProductsFromCSV(result.data, shopifyProducts, processOptions);

      // Step 8: Save data for comparison and results
      const dataSnapshot = {
        ftpData: {
          fileName: path.basename(downloadedFile),
          rowCount: result.stats.processedRows,
          firstItem: result.data[0] || null,
          processedAt: new Date().toISOString()
        },
        shopifyData: {
          productCount: shopifyProducts.length,
          fetchedAt: new Date().toISOString(),
          sampleProducts: shopifyProducts.slice(0, 3).map(p => ({
            id: p.id,
            title: p.title,
            handle: p.handle,
            status: p.status
          }))
        },
        creationResults: creationResults
      };

      // Save snapshot for future comparison
      const snapshotFile = path.join(this.downloadDir, `data_snapshot_${new Date().toISOString().split('T')[0]}.json`);
      fs.writeFileSync(snapshotFile, JSON.stringify(dataSnapshot, null, 2));
      logger.info(`Data snapshot saved: ${snapshotFile}`);

      // Step 9: Clean up old files
      await this.cleanupOldFiles();

      const endTime = Date.now();
      const totalDuration = ((endTime - startTime) / 1000).toFixed(2);
      
      logger.info('='.repeat(50));
      logger.info(`Job completed successfully in ${totalDuration}s`);
      logger.info(`Products created: ${creationResults.created}`);
      logger.info(`Products skipped: ${creationResults.skipped}`);
      logger.info(`Errors: ${creationResults.errors}`);
      logger.info('='.repeat(50));

    } catch (error) {
      logger.error('Job execution failed:', error);
      
      // Send notification or alert here if needed
      // await this.sendErrorAlert(error);
      
    } finally {
      // Clean up FTP connection
      await this.ftpClient.close();
      this.isRunning = false;
    }
  }

  async cleanupOldFiles() {
    try {
      logger.info('Cleaning up old files...');
      
      const files = fs.readdirSync(this.downloadDir);
      const cutoffTime = Date.now() - (this.keepFilesDays * 24 * 60 * 60 * 1000);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.downloadDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isFile() && stats.mtime.getTime() < cutoffTime) {
          fs.unlinkSync(filePath);
          logger.info(`Deleted old file: ${file}`);
          deletedCount++;
        }
      }

      logger.info(`Cleanup completed: ${deletedCount} files deleted`);
    } catch (error) {
      logger.error('Error during cleanup:', error.message);
    }
  }

  start() {
    const schedule = process.env.CRON_SCHEDULE || '0 2 * * *'; // Default: 2 AM daily
    
    logger.info(`Starting cron job with schedule: ${schedule}`);
    
    // Validate cron expression
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid cron schedule: ${schedule}`);
    }

    // Schedule the job
    const task = cron.schedule(schedule, async () => {
      await this.executeJob();
    }, {
      scheduled: true,
      timezone: process.env.TIMEZONE || 'UTC'
    });

    logger.info('Cron job scheduled successfully');

    // Graceful shutdown handling
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      task.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      task.stop();
      process.exit(0);
    });

    return task;
  }

  // Method to run the job immediately (for testing)
  async runOnce() {
    logger.info('Running job once for testing...');
    await this.executeJob();
  }

  // Method to run only Shopify integration (skip FTP download)
  async runShopifyOnly() {
    if (this.isRunning) {
      logger.warn('Job is already running, skipping this execution');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      logger.info('='.repeat(50));
      logger.info('Running Shopify-only integration (skipping FTP download)');
      logger.info('='.repeat(50));

      // Check if we have an existing CSV file to process
      const existingFiles = fs.readdirSync(this.downloadDir).filter(file => 
        file.endsWith('.csv') && file.includes('Extract')
      );

      let ftpData = null;
      let csvData = [];
      
      if (existingFiles.length > 0) {
        const latestFile = existingFiles.sort().pop();
        const filePath = path.join(this.downloadDir, latestFile);
        
        logger.info(`Found existing CSV file: ${latestFile}`);
        
        // Get file information
        const fileInfo = await this.csvProcessor.getFileInfo(filePath);
        logger.info(`File info: ${fileInfo.sizeMB} MB, estimated ${fileInfo.estimatedRows} rows`);

        // Process the CSV file
        const result = await this.csvProcessor.processFile(filePath);
        csvData = result.data;
        
        // Log results and first item
        logger.info('CSV processing completed successfully');
        logger.info(`Processed ${result.stats.processedRows} products in ${result.stats.duration}s`);
        
        if (result.data.length > 0) {
          logger.info('First product item:', JSON.stringify(result.data[0], null, 2));
        }

        ftpData = {
          fileName: path.basename(filePath),
          rowCount: result.stats.processedRows,
          firstItem: result.data[0] || null,
          processedAt: new Date().toISOString()
        };
      } else {
        logger.warn('No existing CSV files found in downloads directory');
        logger.info('FTP data will be marked as unavailable in snapshot');
        ftpData = {
          fileName: 'none',
          rowCount: 0,
          firstItem: null,
          processedAt: new Date().toISOString(),
          note: 'No CSV file available - run full sync first'
        };
      }

      // Fetch Shopify products
      logger.info('Fetching products from Shopify...');
      const shopifyProducts = await this.shopifyClient.getAllProducts();
      this.shopifyClient.logProductSummary(shopifyProducts);

      // Create products from CSV data if available
      let creationResults = null;
      if (csvData.length > 0) {
        logger.info('='.repeat(50));
        logger.info('Starting product creation from CSV data...');
        
        // Configuration for product creation
        const createOptions = {
          batchSize: parseInt(process.env.SHOPIFY_BATCH_SIZE) || 20,
          delayBetweenBatches: parseInt(process.env.SHOPIFY_BATCH_DELAY) || 2000,
          skipExisting: process.env.SHOPIFY_SKIP_EXISTING !== 'false',
          dryRun: process.env.SHOPIFY_DRY_RUN === 'true'
        };

        logger.info(`Creation options:`, createOptions);
        
        creationResults = await this.shopifyClient.createProductsFromCSV(csvData, shopifyProducts, createOptions);
      }

      // Save data snapshot
      const dataSnapshot = {
        mode: 'shopify-only',
        ftpData,
        shopifyData: {
          productCount: shopifyProducts.length,
          fetchedAt: new Date().toISOString(),
          sampleProducts: shopifyProducts.slice(0, 3).map(p => ({
            id: p.id,
            title: p.title,
            handle: p.handle,
            status: p.status
          }))
        },
        creationResults: creationResults || {
          note: 'No CSV data available for product creation'
        }
      };

      // Save snapshot
      const snapshotFile = path.join(this.downloadDir, `shopify_only_snapshot_${new Date().toISOString().split('T')[0]}.json`);
      fs.writeFileSync(snapshotFile, JSON.stringify(dataSnapshot, null, 2));
      logger.info(`Shopify-only snapshot saved: ${snapshotFile}`);

      const endTime = Date.now();
      const totalDuration = ((endTime - startTime) / 1000).toFixed(2);
      
      logger.info('='.repeat(50));
      logger.info(`Shopify-only job completed successfully in ${totalDuration}s`);
      
      if (creationResults) {
        logger.info(`Products created: ${creationResults.created}`);
        logger.info(`Products skipped: ${creationResults.skipped}`);
        logger.info(`Errors: ${creationResults.errors}`);
      }
      
      logger.info('='.repeat(50));

    } catch (error) {
      logger.error('Shopify-only job execution failed:', error);
      throw error;
      
    } finally {
      this.isRunning = false;
    }
  }

  // Method to create products from CSV only (for testing product creation)
  async runCreateProductsOnly(options = {}) {
    if (this.isRunning) {
      logger.warn('Job is already running, skipping this execution');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      logger.info('='.repeat(50));
      logger.info('Running product creation only (from existing CSV)');
      logger.info('='.repeat(50));

      // Check if we have an existing CSV file to process
      const existingFiles = fs.readdirSync(this.downloadDir).filter(file => 
        file.endsWith('.csv') && file.includes('Extract')
      );

      if (existingFiles.length === 0) {
        throw new Error('No CSV files found in downloads directory. Please run a full sync first.');
      }

      const latestFile = existingFiles.sort().pop();
      const filePath = path.join(this.downloadDir, latestFile);
      
      logger.info(`Using CSV file: ${latestFile}`);
      
      // Get file information
      const fileInfo = await this.csvProcessor.getFileInfo(filePath);
      logger.info(`File info: ${fileInfo.sizeMB} MB, estimated ${fileInfo.estimatedRows} rows`);

      // Process the CSV file
      const result = await this.csvProcessor.processFile(filePath);
      
      logger.info('CSV processing completed successfully');
      logger.info(`Processed ${result.stats.processedRows} products in ${result.stats.duration}s`);

      // Create products from CSV data
      const createOptions = {
        batchSize: parseInt(process.env.SHOPIFY_BATCH_SIZE) || 5,
        delayBetweenBatches: parseInt(process.env.SHOPIFY_BATCH_DELAY) || 2000,
        skipExisting: process.env.SHOPIFY_SKIP_EXISTING !== 'false',
        dryRun: process.env.SHOPIFY_DRY_RUN === 'true',
        ...options
      };

      logger.info(`Creation options:`, createOptions);
      
      const creationResults = await this.shopifyClient.createProductsFromCSV(result.data, NULL, createOptions);

      // Save results
      const resultsFile = path.join(this.downloadDir, `creation_results_${new Date().toISOString().split('T')[0]}.json`);
      fs.writeFileSync(resultsFile, JSON.stringify({
        csvFile: latestFile,
        creationResults,
        processedAt: new Date().toISOString()
      }, null, 2));
      
      logger.info(`Creation results saved: ${resultsFile}`);

      const endTime = Date.now();
      const totalDuration = ((endTime - startTime) / 1000).toFixed(2);
      
      logger.info('='.repeat(50));
      logger.info(`Product creation completed in ${totalDuration}s`);
      logger.info(`Products created: ${creationResults.created}`);
      logger.info(`Products skipped: ${creationResults.skipped}`);
      logger.info(`Errors: ${creationResults.errors}`);
      logger.info('='.repeat(50));

      return creationResults;

    } catch (error) {
      logger.error('Product creation job failed:', error);
      throw error;
      
    } finally {
      this.isRunning = false;
    }
  }
}

// Main execution
async function main() {
  try {
    const cronJob = new ProductDataCronJob();
    await cronJob.init();

    // Check command line arguments
    const runOnce = process.argv.includes('--run-once');
    const shopifyOnly = process.argv.includes('--shopify-only');
    const createProductsOnly = process.argv.includes('--create-products');
    
    if (runOnce) {
      await cronJob.runOnce();
      process.exit(0);
    } else if (shopifyOnly) {
      await cronJob.runShopifyOnly();
      process.exit(0);
    } else if (createProductsOnly) {
      // Parse additional options for product creation
      const dryRunIndex = process.argv.indexOf('--dry-run');
      const batchSizeIndex = process.argv.indexOf('--batch-size');
      const skipExistingIndex = process.argv.indexOf('--no-skip-existing');
      
      const options = {};
      if (dryRunIndex !== -1) options.dryRun = true;
      if (batchSizeIndex !== -1 && process.argv[batchSizeIndex + 1]) {
        options.batchSize = parseInt(process.argv[batchSizeIndex + 1]);
      }
      if (skipExistingIndex !== -1) options.skipExisting = false;
      
      await cronJob.runCreateProductsOnly(options);
      process.exit(0);
    } else {
      cronJob.start();
      logger.info('Application started. Press Ctrl+C to stop.');
    }

  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  main();
}

module.exports = ProductDataCronJob;
