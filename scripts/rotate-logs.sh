#!/data/data/com.termux/files/usr/bin/bash
# Log rotation script for discord-irc bot
# Run this periodically via cron or termux-job-scheduler to prevent log bloat

LOG_DIR="$HOME/.local/share/termux-boot/logs"
LOG_FILE="$LOG_DIR/discord-bot.log"
MAX_SIZE_MB=10  # Rotate when log exceeds this size
KEEP_ROTATIONS=3  # Number of old logs to keep

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Check if log file exists
if [ ! -f "$LOG_FILE" ]; then
    echo "Log file not found: $LOG_FILE"
    exit 0
fi

# Get current log size in MB
SIZE_MB=$(du -m "$LOG_FILE" | cut -f1)

echo "Current log size: ${SIZE_MB}MB (max: ${MAX_SIZE_MB}MB)"

# Rotate if log exceeds max size
if [ "$SIZE_MB" -ge "$MAX_SIZE_MB" ]; then
    echo "Rotating logs..."

    # Remove oldest rotation
    if [ -f "${LOG_FILE}.${KEEP_ROTATIONS}" ]; then
        rm -f "${LOG_FILE}.${KEEP_ROTATIONS}"
        echo "  Removed: ${LOG_FILE}.${KEEP_ROTATIONS}"
    fi

    # Rotate existing logs
    for i in $(seq $((KEEP_ROTATIONS - 1)) -1 1); do
        if [ -f "${LOG_FILE}.${i}" ]; then
            mv "${LOG_FILE}.${i}" "${LOG_FILE}.$((i + 1))"
            echo "  Rotated: ${LOG_FILE}.${i} -> ${LOG_FILE}.$((i + 1))"
        fi
    done

    # Rotate current log
    mv "$LOG_FILE" "${LOG_FILE}.1"
    echo "  Rotated: ${LOG_FILE} -> ${LOG_FILE}.1"

    # Create empty new log
    touch "$LOG_FILE"
    echo "  Created: new empty ${LOG_FILE}"

    echo "Log rotation complete!"
else
    echo "Log size is under limit, no rotation needed."
fi

# Show log files
echo ""
echo "Current log files:"
ls -lh "$LOG_DIR"/*.log* 2>/dev/null | sed 's/^/  /'
