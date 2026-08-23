-- AlterTable
ALTER TABLE `mp_unmatched_payments` MODIFY `status` ENUM('open', 'matched', 'dismissed', 'other_income') NOT NULL DEFAULT 'open';

-- CreateTable
CREATE TABLE `other_incomes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `amount` DECIMAL(10, 2) NOT NULL,
    `received_at` DATETIME(3) NOT NULL,
    `concept` VARCHAR(200) NOT NULL,
    `method` ENUM('cash', 'mp') NOT NULL,
    `mp_payment_id` VARCHAR(64) NULL,
    `note` VARCHAR(200) NULL,
    `registered_by_id` INTEGER NULL,
    `voided_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(200) NULL,
    `voided_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `other_incomes_mp_payment_id_key`(`mp_payment_id`),
    INDEX `other_incomes_received_at_idx`(`received_at`),
    INDEX `other_incomes_method_idx`(`method`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `other_incomes` ADD CONSTRAINT `other_incomes_registered_by_id_fkey` FOREIGN KEY (`registered_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `other_incomes` ADD CONSTRAINT `other_incomes_voided_by_id_fkey` FOREIGN KEY (`voided_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
