#!/bin/bash
# =============================================================================
# Install Backup Cron Job
# =============================================================================
# This script sets up the daily backup cron job
# Run this once on the server to enable automatic daily backups
#
# Usage: sudo ./install-backup-cron.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-db.sh"
CRON_LOG="/var/log/survey-backup.log"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================="
echo "Installing Survey Database Backup Cron"
echo -e "==========================================${NC}"

# Make backup script executable
chmod +x "$BACKUP_SCRIPT"
echo "✓ Made backup script executable"

# Create log file
touch "$CRON_LOG"
chmod 644 "$CRON_LOG"
echo "✓ Created log file: $CRON_LOG"

# Create cron job (runs at 2:00 AM daily)
CRON_ENTRY="0 2 * * * $BACKUP_SCRIPT >> $CRON_LOG 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "backup-db.sh"; then
    echo -e "${YELLOW}⚠ Backup cron job already exists. Updating...${NC}"
    # Remove existing entry and add new one
    (crontab -l 2>/dev/null | grep -v "backup-db.sh"; echo "$CRON_ENTRY") | crontab -
else
    # Add new cron job
    (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
fi

echo "✓ Installed cron job"
echo ""
echo "Cron schedule: Daily at 2:00 AM"
echo "Backup location: /root/backup"
echo "Log file: $CRON_LOG"
echo ""
echo "Current cron jobs:"
crontab -l 2>/dev/null | grep -E "(backup|survey)" || echo "  (none found)"
echo ""
echo -e "${GREEN}=========================================="
echo "Installation complete!"
echo ""
echo "To run a manual backup now:"
echo "  $BACKUP_SCRIPT"
echo ""
echo "To view backup logs:"
echo "  tail -f $CRON_LOG"
echo -e "==========================================${NC}"
