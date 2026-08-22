-- AlterTable
ALTER TABLE `mp_subscriptions` ADD COLUMN `amount` DECIMAL(10, 2) NULL,
    ADD COLUMN `external_reference` VARCHAR(128) NULL;

-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `error` VARCHAR(200) NULL,
    MODIFY `type` ENUM('email_verification', 'password_invitation', 'application_result', 'reregistration_first', 'reregistration_second', 'withdrawal_declared', 'fee_reminder', 'arrears_alert', 'receipt', 'payment_rejected', 'board_digest', 'generic') NOT NULL,
    MODIFY `status` ENUM('sent', 'delivered', 'bounced', 'posted_board', 'completed_board', 'failed') NOT NULL;

-- CreateTable
CREATE TABLE `fee_values` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `active_amount` DECIMAL(10, 2) NOT NULL,
    `shared_amount` DECIMAL(10, 2) NOT NULL,
    `valid_from` DATETIME(3) NOT NULL,
    `minute_id` INTEGER NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `fee_values_valid_from_idx`(`valid_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fees` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `member_id` INTEGER NOT NULL,
    `period` CHAR(7) NOT NULL,
    `status` ENUM('pending', 'paid', 'exempt', 'voided') NOT NULL DEFAULT 'pending',
    `origin` ENUM('accrual', 'import') NOT NULL DEFAULT 'accrual',
    `payment_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fees_status_idx`(`status`),
    INDEX `fees_member_id_status_idx`(`member_id`, `status`),
    INDEX `fees_period_status_idx`(`period`, `status`),
    UNIQUE INDEX `fees_member_id_period_key`(`member_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `member_id` INTEGER NULL,
    `application_id` INTEGER NULL,
    `type` ENUM('debit', 'link', 'cash', 'voluntary', 'entry', 'extraordinary') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `paid_at` DATETIME(3) NOT NULL,
    `mp_payment_id` VARCHAR(64) NULL,
    `preapproval_id` VARCHAR(64) NULL,
    `registered_by_id` INTEGER NULL,
    `note` VARCHAR(200) NULL,
    `status` ENUM('applied', 'refunded', 'voided') NOT NULL DEFAULT 'applied',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payments_mp_payment_id_key`(`mp_payment_id`),
    INDEX `payments_member_id_paid_at_idx`(`member_id`, `paid_at`),
    INDEX `payments_paid_at_idx`(`paid_at`),
    INDEX `payments_preapproval_id_idx`(`preapproval_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` CHAR(10) NOT NULL,
    `year` SMALLINT NOT NULL,
    `seq` INTEGER NOT NULL,
    `payment_id` INTEGER NOT NULL,
    `concept` VARCHAR(200) NOT NULL,
    `pdf_path` VARCHAR(255) NULL,
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `emailed_at` DATETIME(3) NULL,
    `voided_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(200) NULL,
    `voided_by_id` INTEGER NULL,

    UNIQUE INDEX `receipts_number_key`(`number`),
    UNIQUE INDEX `receipts_payment_id_key`(`payment_id`),
    UNIQUE INDEX `receipts_year_seq_key`(`year`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receipt_sequences` (
    `year` SMALLINT NOT NULL,
    `last` INTEGER NOT NULL,

    PRIMARY KEY (`year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mp_unmatched_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mp_payment_id` VARCHAR(64) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `paid_at` DATETIME(3) NOT NULL,
    `payer_email` VARCHAR(191) NULL,
    `external_reference` VARCHAR(128) NULL,
    `description` VARCHAR(200) NULL,
    `status` ENUM('open', 'matched', 'dismissed') NOT NULL DEFAULT 'open',
    `payment_id` INTEGER NULL,
    `resolved_by_id` INTEGER NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `mp_unmatched_payments_mp_payment_id_key`(`mp_payment_id`),
    INDEX `mp_unmatched_payments_status_idx`(`status`),
    INDEX `mp_unmatched_payments_payment_id_idx`(`payment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cron_runs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `job` VARCHAR(32) NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `finished_at` DATETIME(3) NULL,
    `ok` BOOLEAN NOT NULL DEFAULT false,
    `summary` JSON NULL,
    `error` VARCHAR(500) NULL,

    INDEX `cron_runs_job_started_at_idx`(`job`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `mp_subscriptions_status_idx` ON `mp_subscriptions`(`status`);

-- AddForeignKey
ALTER TABLE `fee_values` ADD CONSTRAINT `fee_values_minute_id_fkey` FOREIGN KEY (`minute_id`) REFERENCES `minutes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_values` ADD CONSTRAINT `fee_values_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fees` ADD CONSTRAINT `fees_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fees` ADD CONSTRAINT `fees_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_registered_by_id_fkey` FOREIGN KEY (`registered_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_voided_by_id_fkey` FOREIGN KEY (`voided_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mp_unmatched_payments` ADD CONSTRAINT `mp_unmatched_payments_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mp_unmatched_payments` ADD CONSTRAINT `mp_unmatched_payments_resolved_by_id_fkey` FOREIGN KEY (`resolved_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
-- OJO al regenerar: Prisma emitio alguna vez CREATE + DROP para este indice,
-- y contra MariaDB 10.11 eso falla con el error 1091 ("Can't DROP INDEX"):
-- el motor elimina solo el indice implicito de la FK apenas se crea otro que
-- la cubre, asi que cuando llega el DROP ese indice ya no existe. RENAME INDEX
-- hace lo mismo en un solo paso y es deterministico (soportado desde MariaDB
-- 10.5.2; local y el VPS corren 10.11).
ALTER TABLE `mp_subscriptions` RENAME INDEX `mp_subscriptions_member_id_fkey` TO `mp_subscriptions_member_id_idx`;
