#!/bin/bash
# =============================================================================
# Restore Database from Backup
# =============================================================================
# This script restores the MySQL database from a backup file
#
# Usage: ./restore-db.sh [backup_file.sql.gz]
# Example: ./restore-db.sh /root/backup/survey_db_20260207_020000.sql.gz
# =============================================================================

set -e

# Configuration
MYSQL_CONTAINER="survey-mysql"
DB_NAME="${DB_NAME:-survey_db}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log_success() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${GREEN}✓ $1${NC}"
}

log_error() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${RED}✗ $1${NC}"
}

log_warning() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${YELLOW}⚠ $1${NC}"
}

# Load environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
elif [ -f "/root/bit-survey-app/.env" ]; then
    source "/root/bit-survey-app/.env"
fi

# Check arguments
if [ -z "$1" ]; then
    log_error "Usage: $0 <backup_file.sql.gz>"
    echo ""
    echo "Available backups:"
    ls -lh /root/backup/survey_db_*.sql.gz 2>/dev/null || echo "  No backups found in /root/backup"
    exit 1
fi

BACKUP_FILE="$1"

# Validate backup file
if [ ! -f "$BACKUP_FILE" ]; then
    log_error "Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Validate required variables
if [ -z "$MYSQL_ROOT_PASSWORD" ]; then
    log_error "MYSQL_ROOT_PASSWORD is not set"
    exit 1
fi

log "=========================================="
log "Starting Database Restore"
log "=========================================="
log "Backup file: $BACKUP_FILE"
log "Container: $MYSQL_CONTAINER"
log "Database: $DB_NAME"

# Confirmation
echo ""
log_warning "WARNING: This will overwrite the current database!"
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    log "Restore cancelled"
    exit 0
fi

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${MYSQL_CONTAINER}$"; then
    log_error "MySQL container '$MYSQL_CONTAINER' is not running!"
    exit 1
fi

log_success "MySQL container is running"

# Restore database
log "Restoring database from backup..."

gunzip -c "$BACKUP_FILE" | docker exec -i "$MYSQL_CONTAINER" \
    mysql \
    --user=root \
    --password="$MYSQL_ROOT_PASSWORD"

if [ $? -eq 0 ]; then
    log_success "Database restored successfully!"
else
    log_error "Restore failed!"
    exit 1
fi

log "=========================================="
log_success "Restore process completed!"
log "=========================================="
