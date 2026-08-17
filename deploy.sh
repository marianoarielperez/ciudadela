#!/usr/bin/env bash
# Deploy de SIGeV en el VPS. Uso: bash deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/root/dev/ciudadela}"
cd "$APP_DIR"

git pull --ff-only
# OJO: `npm ci` a secas, SIN --omit=dev y SIN NODE_ENV=production.
# Las devDependencies son necesarias en el VPS: el `postinstall` corre
# `prisma generate` (el CLI `prisma` y `dotenv` son devDependencies) y
# `prisma db seed` corre con `tsx` (tambien devDependency). Podarlas rompe el deploy.
npm ci
npx prisma migrate deploy
npm run build
pm2 restart sigev --update-env
pm2 save

echo "Deploy OK: $(git rev-parse --short HEAD)"
