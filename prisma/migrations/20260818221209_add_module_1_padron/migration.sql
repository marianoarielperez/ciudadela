-- CreateTable
CREATE TABLE `members` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `full_name` VARCHAR(160) NOT NULL,
    `dni` VARCHAR(12) NULL,
    `birth_date` DATETIME(3) NULL,
    `civil_status` VARCHAR(40) NULL,
    `nationality` VARCHAR(60) NULL,
    `occupation` VARCHAR(80) NULL,
    `phone` VARCHAR(40) NULL,
    `street_id` INTEGER NULL,
    `street_text` VARCHAR(120) NULL,
    `street_number` VARCHAR(10) NULL,
    `neighborhood` VARCHAR(60) NULL,
    `email` VARCHAR(191) NULL,
    `email_status` ENUM('none', 'declared', 'verified', 'bounced') NOT NULL DEFAULT 'none',
    `email_verified_at` DATETIME(3) NULL,
    `category` ENUM('active', 'adherent', 'collaborator', 'cadet', 'honorary', 'lifetime') NOT NULL,
    `status` ENUM('active', 'suspended', 'withdrawn') NOT NULL,
    `withdrawal_reason` ENUM('death', 'resignation', 'arrears', 'moved_away', 'not_reregistered', 'expulsion', 'duplicate_annulment', 'other') NULL,
    `joined_at` DATETIME(3) NOT NULL,
    `left_at` DATETIME(3) NULL,
    `debt_at_withdrawal` BOOLEAN NOT NULL DEFAULT false,
    `auto_debit` BOOLEAN NOT NULL DEFAULT false,
    `reentry_blocked` BOOLEAN NOT NULL DEFAULT false,
    `rejected_until` DATETIME(3) NULL,
    `suspended_from` DATETIME(3) NULL,
    `suspended_to` DATETIME(3) NULL,
    `user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `members_dni_key`(`dni`),
    UNIQUE INDEX `members_user_id_key`(`user_id`),
    INDEX `members_full_name_idx`(`full_name`),
    INDEX `members_status_category_idx`(`status`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `books` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` INTEGER NOT NULL,
    `status` ENUM('open', 'closed') NOT NULL,
    `opened_at` DATETIME(3) NOT NULL,
    `closed_at` DATETIME(3) NULL,
    `opening_minute_id` INTEGER NULL,
    `closing_minute_id` INTEGER NULL,

    UNIQUE INDEX `books_number_key`(`number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `memberships` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `member_id` INTEGER NOT NULL,
    `book_id` INTEGER NOT NULL,
    `member_number` INTEGER NOT NULL,

    UNIQUE INDEX `memberships_book_id_member_number_key`(`book_id`, `member_number`),
    UNIQUE INDEX `memberships_member_id_book_id_key`(`member_id`, `book_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `minutes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('board', 'assembly') NOT NULL,
    `number` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `description` VARCHAR(500) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `minutes_type_number_key`(`type`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `movements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `member_id` INTEGER NOT NULL,
    `type` ENUM('admission', 'withdrawal', 'category_change', 'readmission', 'suspension', 'suspension_end', 'book_migration') NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `minute_id` INTEGER NULL,
    `previous_category` ENUM('active', 'adherent', 'collaborator', 'cadet', 'honorary', 'lifetime') NULL,
    `new_category` ENUM('active', 'adherent', 'collaborator', 'cadet', 'honorary', 'lifetime') NULL,
    `reason` ENUM('death', 'resignation', 'arrears', 'moved_away', 'not_reregistered', 'expulsion', 'duplicate_annulment', 'other') NULL,
    `detail` VARCHAR(300) NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `movements_member_id_idx`(`member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `streets` (
    `id` INTEGER NOT NULL,
    `load_order` INTEGER NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `normalized_name` VARCHAR(80) NOT NULL,

    INDEX `streets_normalized_name_idx`(`normalized_name`),
    INDEX `streets_load_order_idx`(`load_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `member_id` INTEGER NULL,
    `type` ENUM('email_verification', 'password_invitation', 'application_result', 'reregistration_first', 'reregistration_second', 'withdrawal_declared', 'fee_reminder', 'arrears_alert', 'receipt', 'generic') NOT NULL,
    `via` ENUM('email', 'board') NOT NULL,
    `status` ENUM('sent', 'delivered', 'bounced', 'posted_board', 'completed_board') NOT NULL,
    `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `brevo_message_id` VARCHAR(128) NULL,
    `board_from` DATETIME(3) NULL,
    `board_to` DATETIME(3) NULL,
    `payload_summary` VARCHAR(300) NULL,

    INDEX `notifications_member_id_idx`(`member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `action_tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purpose` ENUM('email_verification', 'password_invitation', 'password_reset') NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `member_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `action_tokens_token_hash_key`(`token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `members` ADD CONSTRAINT `members_street_id_fkey` FOREIGN KEY (`street_id`) REFERENCES `streets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `members` ADD CONSTRAINT `members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_book_id_fkey` FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `movements` ADD CONSTRAINT `movements_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `movements` ADD CONSTRAINT `movements_minute_id_fkey` FOREIGN KEY (`minute_id`) REFERENCES `minutes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `action_tokens` ADD CONSTRAINT `action_tokens_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
