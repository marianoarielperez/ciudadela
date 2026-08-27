-- Exención de cuota (Art. 7 inc. a.4): el registro de las eximiciones que
-- resuelve la Comisión, más tres valores de enum.
--
-- Los dos `MODIFY ENUM` son ADITIVOS y los valores nuevos van al FINAL de cada
-- lista. Que vayan al final y no en el medio es deliberado: un ENUM se guarda
-- como ÍNDICE y no como texto (medido: en `fees`, `origin+0` da 1 para
-- 'accrual' y 2 para 'import'), así que intercalar un valor le corre el
-- significado a cada fila ya escrita — 3115 en `fees` al momento de esta
-- migración.
--
-- Las tres FKs a `members` y a `minutes` son RESTRICT a propósito: ni la ficha
-- del socio eximido ni el acta que respalda la decisión —ni la del asiento ni la
-- de la anulación— se pueden borrar por debajo del registro.

-- AlterTable
ALTER TABLE `fees` MODIFY `origin` ENUM('accrual', 'import', 'exemption') NOT NULL DEFAULT 'accrual';

-- AlterTable
ALTER TABLE `movements` MODIFY `type` ENUM('admission', 'withdrawal', 'category_change', 'readmission', 'suspension', 'suspension_end', 'book_migration', 'fee_exemption', 'fee_exemption_revoked') NOT NULL;

-- CreateTable
CREATE TABLE `fee_exemptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `member_id` INTEGER NOT NULL,
    `from_period` CHAR(7) NOT NULL,
    `to_period` CHAR(7) NOT NULL,
    `months` INTEGER NOT NULL,
    `minute_id` INTEGER NOT NULL,
    `note` VARCHAR(300) NULL,
    `created_by_id` INTEGER NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoke_minute_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `fee_exemptions_member_id_idx`(`member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `fee_exemptions` ADD CONSTRAINT `fee_exemptions_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_exemptions` ADD CONSTRAINT `fee_exemptions_minute_id_fkey` FOREIGN KEY (`minute_id`) REFERENCES `minutes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_exemptions` ADD CONSTRAINT `fee_exemptions_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_exemptions` ADD CONSTRAINT `fee_exemptions_revoke_minute_id_fkey` FOREIGN KEY (`revoke_minute_id`) REFERENCES `minutes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
