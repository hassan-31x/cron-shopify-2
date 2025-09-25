# AWS EC2 Deployment Guide

## Prerequisites

### 1. AWS EC2 Instance
- **Recommended**: t3.medium or larger (2 vCPU, 4 GB RAM)
- **OS**: Amazon Linux 2 or Ubuntu 20.04+
- **Storage**: At least 20 GB (for Docker images and logs)
- **Security Group**: Allow inbound traffic on ports 22 (SSH) and optionally 3000 (health checks)

### 2. Required AWS Permissions
Ensure your EC2 instance has:
- Internet access for downloading packages and Docker images
- Sufficient IAM permissions if using AWS services

## Quick Deployment

### Option 1: Automated Script (Recommended)
```bash
# SSH into your EC2 instance
ssh -i your-key.pem ec2-user@your-instance-ip

# Download and run the deployment script
curl -fsSL https://raw.githubusercontent.com/hassan-31x/cron-shopify/main/deploy-ec2.sh -o deploy-ec2.sh
chmod +x deploy-ec2.sh
sudo ./deploy-ec2.sh
```

### Option 2: Manual Deployment
```bash
# 1. Update system and install Docker
sudo yum update -y
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user

# 2. Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 3. Clone repository
git clone https://github.com/hassan-31x/cron-shopify.git
cd cron-shopify

# 4. Setup environment
cp .env.production .env
nano .env  # Update your Shopify credentials

# 5. Create data directories
mkdir -p data/{downloads,logs}

# 6. Start the application
docker-compose up -d
```

## Configuration

### Environment Variables
Edit `/opt/shopify-cron/.env` (or your project directory):

**Required:**
- `SHOPIFY_STORE_URL`: Your Shopify store URL (e.g., mystore.myshopify.com)
- `SHOPIFY_ACCESS_TOKEN`: Your Shopify private app access token

**Optional:**
- `SHOPIFY_BATCH_SIZE`: Products per batch (default: 20)
- `CRON_SCHEDULE`: Cron expression for scheduling (default: 0 2 * * * - daily at 2 AM)
- `LOG_LEVEL`: Logging level (info, debug, warn, error)

### Shopify Setup
1. Go to your Shopify Admin → Apps → App and sales channel settings
2. Develop apps → Create an app
3. Configure Admin API scopes:
   - `read_products`
   - `write_products` 
   - `read_product_listings`
   - `write_product_listings`
4. Install the app and copy the access token

## Management Commands

### Application Control
```bash
# Navigate to app directory
cd /opt/shopify-cron

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Restart application
docker-compose restart

# Stop application
docker-compose down

# Update application
git pull
docker-compose up --build -d

# Run one-time sync
docker-compose exec shopify-cron node src/index.js --run-once
```

### System Service Control
```bash
# Check service status
sudo systemctl status shopify-cron

# Start/stop/restart service
sudo systemctl start shopify-cron
sudo systemctl stop shopify-cron
sudo systemctl restart shopify-cron

# View service logs
sudo journalctl -u shopify-cron -f
```

## Monitoring

### Application Logs
```bash
# Application logs
tail -f /opt/shopify-cron/data/logs/app.log

# Error logs
tail -f /opt/shopify-cron/data/logs/error.log

# Docker logs
docker logs -f shopify-product-cron
```

### System Monitoring
```bash
# Container resource usage
docker stats shopify-product-cron

# Disk usage
df -h /opt/shopify-cron

# System resources
htop
```

### Health Checks
The application includes built-in health checks:
- HTTP endpoint: `http://your-server:3000/health` (if enabled)
- Docker health check: `docker ps` shows health status
- Automatic monitoring script runs every 5 minutes

## Troubleshooting

### Common Issues

**Container won't start:**
```bash
# Check logs
docker-compose logs

# Check environment file
cat .env

# Verify Shopify credentials
curl -H "X-Shopify-Access-Token: YOUR_TOKEN" \
     "https://YOUR_STORE.myshopify.com/admin/api/2023-10/shop.json"
```

**Permission errors:**
```bash
# Fix file permissions
sudo chown -R shopify:shopify /opt/shopify-cron
sudo chmod -R 755 /opt/shopify-cron
```

**Out of disk space:**
```bash
# Clean up old Docker images
docker system prune -a

# Clean up old logs
find /opt/shopify-cron/data/logs -name "*.log" -mtime +30 -delete
```

**High memory usage:**
```bash
# Reduce batch size in .env
SHOPIFY_BATCH_SIZE=10

# Restart with new settings
docker-compose restart
```

## Security Considerations

### Environment File Security
```bash
# Secure environment file
sudo chmod 600 /opt/shopify-cron/.env
sudo chown shopify:shopify /opt/shopify-cron/.env
```

### Firewall Configuration
```bash
# Amazon Linux 2
sudo yum install -y iptables-services
sudo systemctl enable iptables
sudo systemctl start iptables

# Allow SSH and optional health check port
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
sudo service iptables save
```

### Regular Updates
```bash
# Create update script
cat > /usr/local/bin/update-shopify-cron.sh << 'EOF'
#!/bin/bash
cd /opt/shopify-cron
git pull
docker-compose up --build -d
docker system prune -f
EOF

chmod +x /usr/local/bin/update-shopify-cron.sh

# Schedule weekly updates (optional)
echo "0 3 * * 0 /usr/local/bin/update-shopify-cron.sh" | sudo crontab -
```

## Scaling and Performance

### Vertical Scaling
- Increase EC2 instance size (t3.large, t3.xlarge)
- Increase Docker resource limits in docker-compose.yml

### Performance Tuning
```bash
# In .env file:
SHOPIFY_BATCH_SIZE=50           # Increase batch size
SHOPIFY_PARALLEL_BATCH=true    # Enable parallel processing
SHOPIFY_BATCH_DELAY=500        # Reduce delay between batches
```

### Monitoring Performance
```bash
# Monitor API rate limits
grep "rate limit" /opt/shopify-cron/data/logs/*.log

# Monitor processing time
grep "COMPLETE" /opt/shopify-cron/data/logs/app.log
```

## Backup and Recovery

### Data Backup
```bash
# Backup configuration and logs
tar -czf shopify-cron-backup-$(date +%Y%m%d).tar.gz \
    /opt/shopify-cron/.env \
    /opt/shopify-cron/data/logs/

# Backup to S3 (if configured)
aws s3 cp shopify-cron-backup-$(date +%Y%m%d).tar.gz s3://your-backup-bucket/
```

### Disaster Recovery
```bash
# Save deployment command for quick recovery
echo "curl -fsSL https://raw.githubusercontent.com/hassan-31x/cron-shopify/main/deploy-ec2.sh | sudo bash" > recovery-command.txt
```

## Support

For issues and questions:
1. Check application logs: `/opt/shopify-cron/data/logs/`
2. Check system logs: `sudo journalctl -u shopify-cron`
3. Review this documentation
4. Check GitHub repository issues
