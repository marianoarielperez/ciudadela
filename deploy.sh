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
# El seed SI corre en cada despliegue, y tiene que correr aca: es idempotente
# (todos sus upsert llevan `update: {}`, nunca pisan lo que el superadmin edito
# desde el panel) y es lo unico que crea las claves de `configuration` que
# estrena cada modulo. Sin este paso, una clave nueva -por ejemplo `terms_text`
# y `privacy_consent_text` del M3- simplemente no existe en el VPS, y el panel
# le muestra al operador un formulario vacio donde docs/10 le dice que revise
# los textos legales.
#
# Va ANTES del build a proposito: /asociate se prerenderiza leyendo esos textos.
npx prisma db seed
npm run build
pm2 restart sigev --update-env
pm2 save

echo "Deploy OK: $(git rev-parse --short HEAD)"
