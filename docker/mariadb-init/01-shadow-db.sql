-- Shadow database para `prisma migrate dev` (solo desarrollo).
-- El usuario `sigev` no tiene permiso para crear bases, por eso SHADOW_DATABASE_URL
-- usa root y la base se crea acá, en la inicialización del contenedor.
-- Mismo charset que `sigev`: si la shadow difiere, las migraciones se validan
-- contra una base que no se parece a la real (tildes y ñ incluidas).
CREATE DATABASE IF NOT EXISTS sigev_shadow
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
