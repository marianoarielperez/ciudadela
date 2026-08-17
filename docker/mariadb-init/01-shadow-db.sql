-- Shadow database para `prisma migrate dev` (solo desarrollo).
-- El usuario `sigev` no tiene permiso para crear bases, por eso SHADOW_DATABASE_URL
-- usa root y la base se crea acá, en la inicialización del contenedor.
CREATE DATABASE IF NOT EXISTS sigev_shadow;
