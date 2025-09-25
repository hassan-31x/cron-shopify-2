const express = require('express');
const logger = require('./src/logger');
const fs = require('fs');
const path = require('path');

// Create Express app for health checks and monitoring
const app = express();
const PORT = process.env.HEALTH_CHECK_PORT || 3002;

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    const healthCheck = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'unknown',
        version: require('./package.json').version
    };
    
    // Check if log files exist and are recent
    try {
        const logDir = './logs';
        if (fs.existsSync(logDir)) {
            const logFiles = fs.readdirSync(logDir).filter(file => file.endsWith('.log'));
            healthCheck.logFiles = logFiles.length;
            
            // Check if app.log exists and when it was last modified
            const appLogPath = path.join(logDir, 'app.log');
            if (fs.existsSync(appLogPath)) {
                const stats = fs.statSync(appLogPath);
                healthCheck.lastLogUpdate = stats.mtime.toISOString();
            }
        }
    } catch (error) {
        healthCheck.logStatus = 'error';
    }
    
    res.status(200).json(healthCheck);
});

// Status endpoint with more detailed information
app.get('/status', (req, res) => {
    const status = {
        application: 'Shopify Product Cron',
        status: 'running',
        timestamp: new Date().toISOString(),
        uptime: {
            seconds: process.uptime(),
            human: formatUptime(process.uptime())
        },
        memory: process.memoryUsage(),
        environment: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            nodeEnv: process.env.NODE_ENV || 'unknown'
        },
        configuration: {
            batchSize: process.env.SHOPIFY_BATCH_SIZE || 'default',
            cronSchedule: process.env.CRON_SCHEDULE || 'default',
            enableUpdates: process.env.SHOPIFY_ENABLE_UPDATES !== 'false',
            dryRun: process.env.SHOPIFY_DRY_RUN === 'true'
        }
    };
    
    // Check file system
    try {
        const downloadsDir = process.env.DOWNLOAD_DIR || './downloads';
        if (fs.existsSync(downloadsDir)) {
            const files = fs.readdirSync(downloadsDir);
            status.downloads = {
                directory: downloadsDir,
                fileCount: files.length,
                csvFiles: files.filter(f => f.endsWith('.csv')).length
            };
        }
    } catch (error) {
        status.downloads = { error: error.message };
    }
    
    res.status(200).json(status);
});

// Logs endpoint (last 100 lines)
app.get('/logs/:type?', (req, res) => {
    const logType = req.params.type || 'app';
    const lines = parseInt(req.query.lines) || 100;
    const logFile = `./logs/${logType}.log`;
    
    if (!fs.existsSync(logFile)) {
        return res.status(404).json({ error: `Log file ${logType}.log not found` });
    }
    
    try {
        const content = fs.readFileSync(logFile, 'utf8');
        const logLines = content.split('\n').slice(-lines).filter(line => line.trim());
        
        res.json({
            logType,
            lines: logLines.length,
            content: logLines
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
    const metrics = {
        timestamp: new Date().toISOString(),
        process: {
            pid: process.pid,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage()
        }
    };
    
    // Add custom metrics from log files if available
    try {
        const appLogPath = './logs/app.log';
        if (fs.existsSync(appLogPath)) {
            const content = fs.readFileSync(appLogPath, 'utf8');
            const lines = content.split('\n');
            
            // Count different types of log entries
            metrics.logs = {
                total: lines.length,
                errors: lines.filter(line => line.includes('ERROR')).length,
                warnings: lines.filter(line => line.includes('WARN')).length,
                created: lines.filter(line => line.includes('Created product:')).length,
                updated: lines.filter(line => line.includes('Updated product:')).length
            };
        }
    } catch (error) {
        metrics.logs = { error: error.message };
    }
    
    res.json(metrics);
});

// Helper function to format uptime
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

// Start server only if this file is run directly (not imported)
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Health check server running on port ${PORT}`);
        console.log(`Health endpoints:`);
        console.log(`  - Health: http://localhost:${PORT}/health`);
        console.log(`  - Status: http://localhost:${PORT}/status`);
        console.log(`  - Logs: http://localhost:${PORT}/logs`);
        console.log(`  - Metrics: http://localhost:${PORT}/metrics`);
    });
}

module.exports = app;
