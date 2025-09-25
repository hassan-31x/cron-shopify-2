#!/bin/bash

# Start script that runs both the health server and the main cron job

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting Shopify Cron Job Application...${NC}"

# Function to cleanup background processes
cleanup() {
    echo -e "\n${BLUE}Shutting down...${NC}"
    if [[ ! -z "$HEALTH_PID" ]]; then
        kill $HEALTH_PID 2>/dev/null
    fi
    if [[ ! -z "$MAIN_PID" ]]; then
        kill $MAIN_PID 2>/dev/null
    fi
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Start health server in background
echo -e "${GREEN}Starting health check server...${NC}"
node health-server.js &
HEALTH_PID=$!

# Wait a moment for health server to start
sleep 2

# Start main cron job application
echo -e "${GREEN}Starting main cron job...${NC}"
node src/index.js &
MAIN_PID=$!

# Wait for both processes
wait $MAIN_PID
wait $HEALTH_PID
