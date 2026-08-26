-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `board_notice_id` INTEGER NULL,
    MODIFY `type` ENUM('email_verification', 'password_invitation', 'application_result', 'reregistration_first', 'reregistration_second', 'withdrawal_declared', 'fee_reminder', 'arrears_alert', 'receipt', 'payment_rejected', 'request_accepted', 'request_rejected', 'board_digest', 'presentation_received', 'presentation_observed', 'generic') NOT NULL;

-- CreateTable
CREATE TABLE `reregistration_processes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `book_id` INTEGER NOT NULL,
    `status` ENUM('preparing', 'first_instance', 'second_instance', 'closing', 'closed') NOT NULL,
    `called_at` DATETIME(3) NOT NULL,
    `first_ends_at` DATETIME(3) NOT NULL,
    `second_ends_at` DATETIME(3) NULL,
    `igj_approved_at` DATETIME(3) NULL,
    `estimated_election_at` DATETIME(3) NULL,
    `call_minute_id` INTEGER NOT NULL,
    `close_minute_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `presentations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `process_id` INTEGER NOT NULL,
    `member_id` INTEGER NOT NULL,
    `status` ENUM('pending', 'submitted', 'observed', 'validated', 'rejected', 'withdrawn') NOT NULL DEFAULT 'pending',
    `channel` ENUM('web', 'in_person') NULL,
    `birth_date` DATETIME(3) NULL,
    `civil_status` VARCHAR(40) NULL,
    `nationality` VARCHAR(60) NULL,
    `occupation` VARCHAR(80) NULL,
    `street_id` INTEGER NULL,
    `street_text` VARCHAR(120) NULL,
    `street_number` VARCHAR(10) NULL,
    `neighborhood` VARCHAR(60) NULL,
    `phone` VARCHAR(40) NULL,
    `email` VARCHAR(191) NULL,
    `resume_token_hash` CHAR(64) NULL,
    `submitted_at` DATETIME(3) NULL,
    `validated_by_id` INTEGER NULL,
    `validated_at` DATETIME(3) NULL,
    `observation` VARCHAR(500) NULL,
    `withdrawal_notified_at` DATETIME(3) NULL,
    `appeal_until` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `presentations_resume_token_hash_key`(`resume_token_hash`),
    INDEX `presentations_process_id_status_idx`(`process_id`, `status`),
    UNIQUE INDEX `presentations_process_id_member_id_key`(`process_id`, `member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holidays` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL,
    `label` VARCHAR(80) NOT NULL,

    UNIQUE INDEX `holidays_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `board_notices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `process_id` INTEGER NOT NULL,
    `kind` ENUM('first_instance', 'second_instance', 'withdrawal', 'other') NOT NULL,
    `posted_at` DATETIME(3) NULL,
    `due_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_board_notice_id_fkey` FOREIGN KEY (`board_notice_id`) REFERENCES `board_notices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reregistration_processes` ADD CONSTRAINT `reregistration_processes_book_id_fkey` FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reregistration_processes` ADD CONSTRAINT `reregistration_processes_call_minute_id_fkey` FOREIGN KEY (`call_minute_id`) REFERENCES `minutes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reregistration_processes` ADD CONSTRAINT `reregistration_processes_close_minute_id_fkey` FOREIGN KEY (`close_minute_id`) REFERENCES `minutes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `presentations` ADD CONSTRAINT `presentations_process_id_fkey` FOREIGN KEY (`process_id`) REFERENCES `reregistration_processes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `presentations` ADD CONSTRAINT `presentations_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `presentations` ADD CONSTRAINT `presentations_street_id_fkey` FOREIGN KEY (`street_id`) REFERENCES `streets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `presentations` ADD CONSTRAINT `presentations_validated_by_id_fkey` FOREIGN KEY (`validated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `board_notices` ADD CONSTRAINT `board_notices_process_id_fkey` FOREIGN KEY (`process_id`) REFERENCES `reregistration_processes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
