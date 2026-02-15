#!/bin/bash
# ETA Automation - Cron Setup (Linux/Mac)
# Run every 30 minutes

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRON_CMD="*/30 * * * * cd $SCRIPT_DIR && source venv/bin/activate && python main.py run >> logs/cron.log 2>&1"

echo "Adding cron job:"
echo "  $CRON_CMD"
echo ""

# Add to crontab (avoiding duplicates)
(crontab -l 2>/dev/null | grep -v "eta-automation"; echo "$CRON_CMD") | crontab -

echo "Done. Current crontab:"
crontab -l
