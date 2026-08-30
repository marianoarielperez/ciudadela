-- CreateTable
CREATE TABLE `institutional_documents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('norm', 'annual_report', 'balance', 'other') NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `description` VARCHAR(200) NULL,
    `year` INTEGER NULL,
    `year_key` VARCHAR(30) NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `size` INTEGER NOT NULL,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `uploaded_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `institutional_documents_year_key_key`(`year_key`),
    INDEX `institutional_documents_type_year_idx`(`type`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `institutional_documents` ADD CONSTRAINT `institutional_documents_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
