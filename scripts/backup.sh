#!/usr/bin/env bash
# Backup nocturno: dumps de MariaDB + uploads, cifrado GPG, subida a Drive.
# Cron: 0 4 * * * (root). Respalda TAMBIÉN cbinfra y sir_database (doc 09:
# el VPS no tiene ningún otro backup de DB).
set -euo pipefail

STAMP=$(date +%F)
WORK=/var/sigev/backups
PASS_FILE=/root/.sigev_backup_pass
REMOTE=gdrive:sigev-backups
RETENTION_DAYS=30

mkdir -p "$WORK"

for db in sigev cbinfra sir_database; do
  mysqldump --single-transaction --routines "$db" | gzip > "$WORK/$db-$STAMP.sql.gz"
done

tar -czf "$WORK/files-$STAMP.tar.gz" -C /var/sigev uploads recibos

for f in "$WORK"/sigev-"$STAMP".sql.gz "$WORK"/cbinfra-"$STAMP".sql.gz \
         "$WORK"/sir_database-"$STAMP".sql.gz "$WORK"/files-"$STAMP".tar.gz; do
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$PASS_FILE" "$f"
  rm "$f"
done

rclone copy "$WORK" "$REMOTE" --include "*-$STAMP*.gpg"

find "$WORK" -name '*.gpg' -mtime +"$RETENTION_DAYS" -delete
rclone delete "$REMOTE" --min-age "${RETENTION_DAYS}d"

echo "[backup] OK $STAMP"
