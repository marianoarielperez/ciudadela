#!/usr/bin/env bash
# Backup nocturno: dumps de MariaDB + uploads, cifrado GPG, subida a Drive.
# Cron: 0 4 * * * (root). Respalda TAMBIÉN cbinfra y sir_database (doc 09:
# el VPS no tiene ningún otro backup de DB).
set -euo pipefail
# Sin esto, un fallo a mitad de camino sale mudo salvo por el exit code: el log
# del cron no dice en qué paso se cortó.
trap 'echo "[backup] FAILED at line $LINENO" >&2' ERR

STAMP=$(date +%F)
WORK=/var/sigev/backups
PASS_FILE=/root/.sigev_backup_pass
REMOTE=gdrive:sigev-backups
RETENTION_DAYS=30

# `recibos` puede no existir todavía (lo crea el Módulo 4) y el tar de abajo lo
# exige sí o sí: lo creamos vacío antes que dejar caer el backup entero.
mkdir -p /var/sigev/uploads /var/sigev/recibos "$WORK"

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
# Acotado a *.gpg: sin el filtro, la poda por antigüedad barre cualquier archivo
# que viva en el remoto, no solo los backups que sube este script.
rclone delete "$REMOTE" --min-age "${RETENTION_DAYS}d" --include "*.gpg"

# Sello de última corrida buena: /admin/salud va a leer su antigüedad para avisar
# si los backups se cortaron sin que nadie mire el log.
date -u +%FT%TZ > "$WORK/LAST_OK"
echo "[backup] OK $STAMP"
