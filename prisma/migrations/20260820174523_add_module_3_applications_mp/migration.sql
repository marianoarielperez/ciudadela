-- AlterTable
ALTER TABLE `action_tokens` ADD COLUMN `application_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `application_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `applications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `full_name` VARCHAR(160) NOT NULL,
    `dni` VARCHAR(12) NOT NULL,
    `birth_date` DATETIME(3) NOT NULL,
    `civil_status` VARCHAR(40) NOT NULL,
    `nationality` VARCHAR(60) NOT NULL,
    `occupation` VARCHAR(80) NOT NULL,
    `phone` VARCHAR(40) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `email_verified_at` DATETIME(3) NULL,
    `street_id` INTEGER NULL,
    `street_text` VARCHAR(120) NULL,
    `street_number` VARCHAR(10) NULL,
    `neighborhood` VARCHAR(60) NULL,
    `requested_category` ENUM('active', 'adherent', 'collaborator', 'cadet', 'honorary', 'lifetime') NOT NULL,
    `wants_debit` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('started', 'pending_payment', 'approved_pending_minute', 'pending_board', 'completed', 'rejected', 'expired') NOT NULL DEFAULT 'started',
    `preapproval_id` VARCHAR(64) NULL,
    `mp_payment_id_entry` VARCHAR(64) NULL,
    `entry_amount` DECIMAL(10, 2) NULL,
    `resume_token_hash` CHAR(64) NOT NULL,
    `member_id` INTEGER NULL,
    `minute_id` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `reminded_at` DATETIME(3) NULL,
    `accepted_terms_at` DATETIME(3) NOT NULL,
    `ip` VARCHAR(45) NOT NULL,
    `user_agent` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `applications_preapproval_id_key`(`preapproval_id`),
    UNIQUE INDEX `applications_resume_token_hash_key`(`resume_token_hash`),
    INDEX `applications_status_idx`(`status`),
    INDEX `applications_dni_idx`(`dni`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_type` ENUM('application', 'member', 'presentation') NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `type` ENUM('dni_front', 'dni_back', 'annex') NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `validated_by_id` INTEGER NULL,
    `validated_at` DATETIME(3) NULL,

    INDEX `documents_owner_type_owner_id_idx`(`owner_type`, `owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mp_subscriptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `preapproval_id` VARCHAR(64) NOT NULL,
    `plan_id` VARCHAR(64) NOT NULL,
    `application_id` INTEGER NULL,
    `member_id` INTEGER NULL,
    `status` VARCHAR(32) NOT NULL,
    `payer_email` VARCHAR(191) NOT NULL,
    `linked_manually` BOOLEAN NOT NULL DEFAULT false,
    `last_sync_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mp_subscriptions_preapproval_id_key`(`preapproval_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `origin` ENUM('mp', 'brevo') NOT NULL,
    `external_event_id` VARCHAR(128) NOT NULL,
    `topic` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,
    `result` VARCHAR(64) NULL,
    `error` VARCHAR(500) NULL,

    UNIQUE INDEX `webhook_events_origin_external_event_id_key`(`origin`, `external_event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `action_tokens` ADD CONSTRAINT `action_tokens_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `applications` ADD CONSTRAINT `applications_street_id_fkey` FOREIGN KEY (`street_id`) REFERENCES `streets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `applications` ADD CONSTRAINT `applications_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `applications` ADD CONSTRAINT `applications_minute_id_fkey` FOREIGN KEY (`minute_id`) REFERENCES `minutes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_validated_by_id_fkey` FOREIGN KEY (`validated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mp_subscriptions` ADD CONSTRAINT `mp_subscriptions_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mp_subscriptions` ADD CONSTRAINT `mp_subscriptions_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
