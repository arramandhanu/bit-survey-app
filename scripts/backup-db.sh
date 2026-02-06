#!/bin/bash
# =============================================================================
# Database Backup Script for Survey Application
# =============================================================================
# This script backs up the MySQL database using docker exec (no mysql client needed)
# and copies the compressed backup to /root/backup on the host
#
# Usage: ./backup-db.sh
# Cron:  0 2 * * * /root/bit-survey-app/scripts/backup-db.sh >> /var/log/survey-backup.log 2>&1
# =============================================================================

set -e

# Configuration
BACKUP_DIR="/root/backup"
MYSQL_CONTAINER="survey-mysql"
DB_NAME="${DB_NAME:-survey_db}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"
RETENTION_DAYS=7

# Generate timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILENAME="survey_db_${TIMESTAMP}.sql"
BACKUP_FILENAME_GZ="${BACKUP_FILENAME}.gz"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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

# Load environment variables if .env exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
    log "Loaded environment from $PROJECT_DIR/.env"
elif [ -f "/root/bit-survey-app/.env" ]; then
    source "/root/bit-survey-app/.env"
    log "Loaded environment from /root/bit-survey-app/.env"
fi

# Validate required variables
if [ -z "$MYSQL_ROOT_PASSWORD" ]; then
    log_error "MYSQL_ROOT_PASSWORD is not set. Cannot proceed with backup."
    exit 1
fi

# Create backup directory if it doesn't exist
if [ ! -d "$BACKUP_DIR" ]; then
    mkdir -p "$BACKUP_DIR"
    log "Created backup directory: $BACKUP_DIR"
fi

log "=========================================="
log "Starting Database Backup"
log "=========================================="
log "Container: $MYSQL_CONTAINER"
log "Database: $DB_NAME"
log "Backup file: $BACKUP_FILENAME_GZ"

# Check if MySQL container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${MYSQL_CONTAINER}$"; then
    log_error "MySQL container '$MYSQL_CONTAINER' is not running!"
    exit 1
fi

log_success "MySQL container is running"

# Run mysqldump inside the MySQL container and compress
log "Running mysqldump inside container..."

docker exec "$MYSQL_CONTAINER" \
    mysqldump \
    --user=root \
    --password="$MYSQL_ROOT_PASSWORD" \
    --single-transaction \
    --routines \
    --triggers \
    --databases "$DB_NAME" \
    2>/dev/null | gzip > "${BACKUP_DIR}/${BACKUP_FILENAME_GZ}"

# Check if backup was successful
if [ $? -eq 0 ] && [ -f "${BACKUP_DIR}/${BACKUP_FILENAME_GZ}" ]; then
    BACKUP_SIZE=$(ls -lh "${BACKUP_DIR}/${BACKUP_FILENAME_GZ}" | awk '{print $5}')
    log_success "Backup completed successfully!"
    log "Backup location: ${BACKUP_DIR}/${BACKUP_FILENAME_GZ}"
    log "Backup size: $BACKUP_SIZE"
else
    log_error "Backup failed!"
    exit 1
fi

# Cleanup old backups (keep last N days)
log "Cleaning up backups older than $RETENTION_DAYS days..."
DELETED_COUNT=$(find "$BACKUP_DIR" -name "survey_db_*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete -print | wc -l)
if [ "$DELETED_COUNT" -gt 0 ]; then
    log_warning "Deleted $DELETED_COUNT old backup(s)"
else
    log "No old backups to delete"
fi

# List current backups
log ""
log "Current backups in $BACKUP_DIR:"
ls -lh "$BACKUP_DIR"/survey_db_*.sql.gz 2>/dev/null || log "No backups found"

log ""
log_success "Backup process completed!"
log "=========================================="
