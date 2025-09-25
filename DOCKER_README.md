# Docker Deployment README

## Quick Start

### Local Development
```bash
# Clone repository
git clone <your-repo-url>
cd shopify-cron

# Setup environment
cp .env.production .env
# Edit .env with your Shopify credentials

# Run with Docker Compose
docker-compose up --build
```

### AWS EC2 Deployment
```bash
# One-command deployment
curl -fsSL https://raw.githubusercontent.com/your-repo/main/deploy-ec2.sh | sudo bash

# Or manual deployment - see AWS_DEPLOYMENT_GUIDE.md
```

## Files Overview

### Docker Files
- `Dockerfile` - Container definition
- `docker-compose.yml` - Service orchestration
- `.dockerignore` - Files to exclude from build
- `start.sh` - Startup script for health server + cron job

### Configuration
- `.env.production` - Production environment template
- `.env` - Your actual environment (not in git)

### Deployment
- `deploy-ec2.sh` - Automated EC2 deployment script
- `AWS_DEPLOYMENT_GUIDE.md` - Detailed deployment guide

### Monitoring
- `health-server.js` - Health check and monitoring endpoints

## Environment Variables

**Required:**
- `SHOPIFY_STORE_URL` - Your Shopify store URL
- `SHOPIFY_ACCESS_TOKEN` - Your Shopify access token

**Optional:**
- `SHOPIFY_BATCH_SIZE=20` - Products per batch
- `SHOPIFY_ENABLE_UPDATES=true` - Enable product updates
- `CRON_SCHEDULE=0 2 * * *` - Daily at 2 AM UTC

## Health Endpoints

Once running, access these endpoints:
- `http://your-server:3000/health` - Basic health check
- `http://your-server:3000/status` - Detailed status
- `http://your-server:3000/logs` - Recent log entries
- `http://your-server:3000/metrics` - Application metrics

## Common Commands

```bash
# Build and start
docker-compose up --build -d

# View logs
docker-compose logs -f

# Restart
docker-compose restart

# Stop
docker-compose down

# Run one-time sync
docker-compose exec shopify-cron node src/index.js --run-once
```

## Troubleshooting

1. **Container won't start**: Check `docker-compose logs`
2. **Permission errors**: Ensure proper file ownership
3. **Shopify connection**: Verify credentials in `.env`
4. **Out of space**: Run `docker system prune -a`

See `AWS_DEPLOYMENT_GUIDE.md` for detailed troubleshooting.

## Support

- Check logs: `docker-compose logs`
- Health status: `curl http://localhost:3000/health`
- System resources: `docker stats`
