#!/bin/bash

# AWS EC2 Shopify Cron Job Deployment Script
# This script sets up Docker, downloads the application, and runs it

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="shopify-cron"
APP_DIR="/opt/shopify-cron"
GITHUB_REPO="hassan-31x/cron-shopify"  # Update with your actual repo
SERVICE_USER="shopify"

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}" >&2
}

warning() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

info() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Update system packages
update_system() {
    log "Updating system packages..."
    
    # Detect OS
    if command -v yum &> /dev/null; then
        # Amazon Linux/RHEL/CentOS
        yum update -y
        yum install -y git curl wget unzip
    elif command -v apt-get &> /dev/null; then
        # Ubuntu/Debian
        apt-get update
        apt-get upgrade -y
        apt-get install -y git curl wget unzip
    else
        error "Unsupported operating system"
        exit 1
    fi
}

# Install Docker
install_docker() {
    log "Installing Docker..."
    
    if command -v docker &> /dev/null; then
        warning "Docker is already installed"
        docker --version
        return
    fi
    
    # Install Docker using the official installation script
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    
    # Start and enable Docker service
    systemctl start docker
    systemctl enable docker
    
    # Add current user to docker group (if not root)
    if [[ $SUDO_USER ]]; then
        usermod -aG docker $SUDO_USER
        log "Added $SUDO_USER to docker group"
    fi
    
    log "Docker installed successfully"
    docker --version
}

# Install Docker Compose
install_docker_compose() {
    log "Installing Docker Compose..."
    
    if command -v docker-compose &> /dev/null; then
        warning "Docker Compose is already installed"
        docker-compose --version
        return
    fi
    
    # Get latest version
    DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d'"' -f4)
    
    # Download and install
    curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    
    # Create symlink for easier access
    ln -sf /usr/local/bin/docker-compose /usr/bin/docker-compose
    
    log "Docker Compose installed successfully"
    docker-compose --version
}

# Create service user
create_service_user() {
    log "Creating service user: $SERVICE_USER"
    
    if id "$SERVICE_USER" &>/dev/null; then
        warning "User $SERVICE_USER already exists"
        return
    fi
    
    useradd -r -s /bin/false -d $APP_DIR $SERVICE_USER
    usermod -aG docker $SERVICE_USER
    
    log "Service user $SERVICE_USER created"
}

# Setup application directory
setup_app_directory() {
    log "Setting up application directory: $APP_DIR"
    
    # Create directory
    mkdir -p $APP_DIR
    cd $APP_DIR
    
    # Create data directories
    mkdir -p data/{downloads,logs}
    
    # Set proper permissions
    chown -R $SERVICE_USER:$SERVICE_USER $APP_DIR
    chmod -R 755 $APP_DIR
    
    log "Application directory setup complete"
}

# Download or update application code
download_application() {
    log "Downloading application code..."
    
    cd $APP_DIR
    
    if [[ -d ".git" ]]; then
        warning "Git repository already exists, pulling latest changes..."
        sudo -u $SERVICE_USER git pull
    else
        # Clone the repository
        sudo -u $SERVICE_USER git clone https://github.com/$GITHUB_REPO.git .
    fi
    
    log "Application code downloaded"
}

# Setup environment file
setup_environment() {
    log "Setting up environment configuration..."
    
    ENV_FILE="$APP_DIR/.env"
    
    if [[ -f "$ENV_FILE" ]]; then
        warning "Environment file already exists. Backing up..."
        cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d-%H%M%S)"
    fi
    
    # Create environment file with prompts
    cat > "$ENV_FILE" << 'EOF'
# FTP Configuration
FTP_HOST=ftp.qgold.com
FTP_PORT=21
FTP_USER=56001
FTP_PASSWORD=Qq-56fdT7gwweath

# Shopify Configuration (UPDATE THESE)
SHOPIFY_STORE_URL=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=your-access-token

# Shopify Processing Settings
SHOPIFY_BATCH_SIZE=20
SHOPIFY_BATCH_DELAY=1000
SHOPIFY_DRY_RUN=false
SHOPIFY_PARALLEL_BATCH=true
SHOPIFY_ENABLE_UPDATES=true

# Cron Configuration
CRON_SCHEDULE=0 2 * * *
TIMEZONE=UTC

# Logging Configuration
LOG_LEVEL=info

# File Processing Configuration
DOWNLOAD_DIR=./downloads
KEEP_FILES_DAYS=7

# Environment
NODE_ENV=production
EOF
    
    chown $SERVICE_USER:$SERVICE_USER "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    
    warning "IMPORTANT: Edit $ENV_FILE and update your Shopify credentials!"
    info "Use: nano $ENV_FILE"
}

# Create systemd service
create_systemd_service() {
    log "Creating systemd service..."
    
    cat > /etc/systemd/system/shopify-cron.service << EOF
[Unit]
Description=Shopify Product Cron Job
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
ExecStartPre=/usr/local/bin/docker-compose down
ExecStart=/usr/local/bin/docker-compose up --build -d
ExecStop=/usr/local/bin/docker-compose down
RemainAfterExit=yes
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    # Create timer for automatic restarts
    cat > /etc/systemd/system/shopify-cron.timer << EOF
[Unit]
Description=Shopify Cron Job Timer
Requires=shopify-cron.service

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
EOF
    
    # Reload systemd and enable service
    systemctl daemon-reload
    systemctl enable shopify-cron.service
    systemctl enable shopify-cron.timer
    
    log "Systemd service created and enabled"
}

# Setup log rotation
setup_log_rotation() {
    log "Setting up log rotation..."
    
    cat > /etc/logrotate.d/shopify-cron << EOF
$APP_DIR/data/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    copytruncate
    su $SERVICE_USER $SERVICE_USER
}
EOF
    
    log "Log rotation configured"
}

# Setup monitoring script
setup_monitoring() {
    log "Setting up monitoring script..."
    
    cat > /usr/local/bin/shopify-cron-monitor.sh << 'EOF'
#!/bin/bash

APP_DIR="/opt/shopify-cron"
LOG_FILE="$APP_DIR/data/logs/monitor.log"

# Function to log with timestamp
log_with_timestamp() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check if container is running
if ! docker ps | grep -q "shopify-product-cron"; then
    log_with_timestamp "ERROR: Shopify cron container is not running. Attempting to restart..."
    cd "$APP_DIR"
    docker-compose up -d
    
    # Wait and check again
    sleep 30
    if docker ps | grep -q "shopify-product-cron"; then
        log_with_timestamp "SUCCESS: Container restarted successfully"
    else
        log_with_timestamp "CRITICAL: Failed to restart container"
        # Could send alert here (email, slack, etc.)
    fi
else
    log_with_timestamp "INFO: Container is running normally"
fi

# Check disk space
DISK_USAGE=$(df $APP_DIR | tail -1 | awk '{print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 80 ]; then
    log_with_timestamp "WARNING: Disk usage is at ${DISK_USAGE}%"
fi
EOF
    
    chmod +x /usr/local/bin/shopify-cron-monitor.sh
    
    # Add to crontab for root
    (crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/shopify-cron-monitor.sh") | crontab -
    
    log "Monitoring script created and scheduled"
}

# Start the application
start_application() {
    log "Starting the application..."
    
    cd $APP_DIR
    
    # Build and start containers
    sudo -u $SERVICE_USER docker-compose up --build -d
    
    # Wait a moment for containers to start
    sleep 10
    
    # Check status
    if sudo -u $SERVICE_USER docker-compose ps | grep -q "Up"; then
        log "Application started successfully!"
        info "Container status:"
        sudo -u $SERVICE_USER docker-compose ps
    else
        error "Failed to start application. Check logs:"
        sudo -u $SERVICE_USER docker-compose logs
        exit 1
    fi
}

# Display final instructions
show_final_instructions() {
    log "Deployment completed successfully!"
    
    echo -e "\n${BLUE}=== FINAL SETUP STEPS ===${NC}"
    echo -e "1. ${YELLOW}Update environment variables:${NC}"
    echo -e "   nano $APP_DIR/.env"
    echo -e "   (Update SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN)"
    
    echo -e "\n2. ${YELLOW}Restart after configuration:${NC}"
    echo -e "   cd $APP_DIR && docker-compose restart"
    
    echo -e "\n${BLUE}=== USEFUL COMMANDS ===${NC}"
    echo -e "${YELLOW}Check status:${NC}        cd $APP_DIR && docker-compose ps"
    echo -e "${YELLOW}View logs:${NC}           cd $APP_DIR && docker-compose logs -f"
    echo -e "${YELLOW}Restart service:${NC}     cd $APP_DIR && docker-compose restart"
    echo -e "${YELLOW}Stop service:${NC}        cd $APP_DIR && docker-compose down"
    echo -e "${YELLOW}Update code:${NC}         cd $APP_DIR && git pull && docker-compose up --build -d"
    
    echo -e "\n${BLUE}=== MONITORING ===${NC}"
    echo -e "${YELLOW}Monitor logs:${NC}        tail -f $APP_DIR/data/logs/*.log"
    echo -e "${YELLOW}System service:${NC}      systemctl status shopify-cron"
    echo -e "${YELLOW}Container stats:${NC}     docker stats shopify-product-cron"
    
    echo -e "\n${GREEN}Application is running at: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):3002${NC}"
}

# Main execution
main() {
    log "Starting AWS EC2 Shopify Cron Job deployment..."
    
    check_root
    update_system
    install_docker
    install_docker_compose
    create_service_user
    setup_app_directory
    download_application
    setup_environment
    create_systemd_service
    setup_log_rotation
    setup_monitoring
    start_application
    show_final_instructions
    
    log "Deployment script completed!"
}

# Run main function
main "$@"
