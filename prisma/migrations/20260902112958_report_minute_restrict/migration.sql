-- DropForeignKey
ALTER TABLE `reports` DROP FOREIGN KEY `reports_filed_minute_id_fkey`;

-- DropIndex
DROP INDEX `reports_filed_minute_id_fkey` ON `reports`;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_filed_minute_id_fkey` FOREIGN KEY (`filed_minute_id`) REFERENCES `minutes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
