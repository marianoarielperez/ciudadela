-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('email_verification', 'password_invitation', 'application_result', 'reregistration_first', 'reregistration_second', 'withdrawal_declared', 'fee_reminder', 'arrears_alert', 'receipt', 'payment_rejected', 'request_accepted', 'request_rejected', 'board_digest', 'generic') NOT NULL;

-- CreateTable
CREATE TABLE `member_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `member_id` INTEGER NOT NULL,
    `type` ENUM('withdrawal', 'category_change') NOT NULL,
    `status` ENUM('pending', 'accepted', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    `requested_category` ENUM('active', 'adherent', 'collaborator', 'cadet', 'honorary', 'lifetime') NULL,
    `message` VARCHAR(500) NULL,
    `text` VARCHAR(2000) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decided_at` DATETIME(3) NULL,
    `decided_by_id` INTEGER NULL,
    `decision_note` VARCHAR(500) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `movement_id` INTEGER NULL,

    INDEX `member_requests_member_id_status_idx`(`member_id`, `status`),
    INDEX `member_requests_status_type_idx`(`status`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `member_requests` ADD CONSTRAINT `member_requests_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_requests` ADD CONSTRAINT `member_requests_decided_by_id_fkey` FOREIGN KEY (`decided_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_requests` ADD CONSTRAINT `member_requests_movement_id_fkey` FOREIGN KEY (`movement_id`) REFERENCES `movements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
