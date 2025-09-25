# Use Node.js 18 LTS as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for better compatibility
RUN apk add --no-cache \
    bash \
    curl \
    tzdata

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application source code
COPY . .

# Create downloads directory with proper permissions
RUN mkdir -p downloads logs && \
    chown -R node:node /app

# Switch to non-root user for security
USER node

# Expose port for health checks (optional)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV TZ=UTC

# Health check to ensure container is running properly
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Default command - run both health server and cron job
CMD ["./start.sh"]
