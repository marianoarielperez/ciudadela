-- N° público del reporte: corrido, sin huecos y asignado al ENVIAR.
--
-- Hasta acá el "N°" que veía el vecino era `reports.id`, y la fila nace `draft`
-- en el paso 1 del wizard: cada wizard abandonado se llevaba un número y la
-- purga de borradores no devuelve el AUTO_INCREMENT. En producción el primer
-- reporte real salió como "N° 16". La serie pasa a pedirse dentro de la
-- transacción del envío (`report_sequences`, misma disciplina que REG-33).

-- AlterTable
ALTER TABLE `reports` ADD COLUMN `number` INTEGER NULL;

-- CreateTable
CREATE TABLE `report_sequences` (
    `id` SMALLINT NOT NULL,
    `last` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `reports_number_key` ON `reports`(`number`);

-- Backfill de lo ya enviado, en ORDEN DE ENVÍO (los borradores quedan en NULL:
-- todavía no tienen número que mostrar). Con variables de sesión y no con
-- funciones de ventana, para no depender de la versión de MariaDB del VPS.
-- El desempate por `id` no es adorno: sin él, dos reportes con el mismo
-- `submitted_at` quedarían en un orden no determinista y el backfill no sería
-- reproducible entre la base local y la de producción.
SET @n := 0;
UPDATE reports SET number = (@n := @n + 1) WHERE status <> 'draft' ORDER BY submitted_at, id;

-- La secuencia arranca donde terminó el backfill: el próximo envío toma @n + 1.
INSERT INTO report_sequences (id, last) VALUES (1, @n) ON DUPLICATE KEY UPDATE last = @n;
