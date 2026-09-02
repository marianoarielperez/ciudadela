-- Módulo 7 (Reportes): dos tablas nuevas, una columna nullable en
-- `notifications` y tres valores de `NotificationType` AL FINAL del enum
-- (después de `generic`): un ENUM se guarda como índice y no como texto, así
-- que intercalar corre el significado de cada fila ya escrita.
-- Estrictamente aditiva: apta para `migrate deploy` sobre la base con socios.

-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `report_id` INTEGER NULL,
    MODIFY `type` ENUM('email_verification', 'password_invitation', 'application_result', 'reregistration_first', 'reregistration_second', 'withdrawal_declared', 'fee_reminder', 'arrears_alert', 'receipt', 'payment_rejected', 'request_accepted', 'request_rejected', 'board_digest', 'presentation_received', 'presentation_observed', 'presentation_rejected', 'generic', 'report_received', 'report_filed', 'report_board_alert') NOT NULL;

-- CreateTable
CREATE TABLE `reports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('claim', 'initiative') NOT NULL,
    `status` ENUM('draft', 'received', 'filed', 'dismissed') NOT NULL DEFAULT 'draft',
    `anonymous` BOOLEAN NOT NULL DEFAULT false,
    `member_id` INTEGER NULL,
    `reporter_name` VARCHAR(160) NULL,
    `reporter_dni` VARCHAR(12) NULL,
    `reporter_phone` VARCHAR(40) NULL,
    `reporter_email` VARCHAR(191) NULL,
    `consent_at` DATETIME(3) NULL,
    `category` VARCHAR(40) NULL,
    `subtype` VARCHAR(60) NULL,
    `description` VARCHAR(2000) NULL,
    `lat` DECIMAL(9, 6) NULL,
    `lng` DECIMAL(9, 6) NULL,
    `outside_boundary` BOOLEAN NOT NULL DEFAULT false,
    `street_id` INTEGER NULL,
    `street_name` VARCHAR(120) NULL,
    `address_detail` VARCHAR(160) NULL,
    `scpl_ticket` VARCHAR(40) NULL,
    `claim_token_hash` CHAR(64) NULL,
    `submitted_at` DATETIME(3) NULL,
    `filed_at` DATETIME(3) NULL,
    `filed_by_id` INTEGER NULL,
    `filed_agency` ENUM('mcr', 'scpl', 'council', 'province', 'camuzzi', 'other') NULL,
    `filed_agency_other` VARCHAR(80) NULL,
    `filed_reference` VARCHAR(80) NULL,
    `filed_minute_id` INTEGER NULL,
    `dismissed_at` DATETIME(3) NULL,
    `dismissed_by_id` INTEGER NULL,
    `dismiss_reason` VARCHAR(300) NULL,
    `dni_purged_at` DATETIME(3) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reports_claim_token_hash_key`(`claim_token_hash`),
    INDEX `reports_status_kind_idx`(`status`, `kind`),
    INDEX `reports_member_id_status_idx`(`member_id`, `status`),
    INDEX `reports_submitted_at_idx`(`submitted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_files` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `report_id` INTEGER NOT NULL,
    `kind` ENUM('photo', 'dni_front', 'dni_back') NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `report_files_report_id_kind_idx`(`report_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_street_id_fkey` FOREIGN KEY (`street_id`) REFERENCES `streets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_filed_by_id_fkey` FOREIGN KEY (`filed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_filed_minute_id_fkey` FOREIGN KEY (`filed_minute_id`) REFERENCES `minutes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_dismissed_by_id_fkey` FOREIGN KEY (`dismissed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_files` ADD CONSTRAINT `report_files_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
