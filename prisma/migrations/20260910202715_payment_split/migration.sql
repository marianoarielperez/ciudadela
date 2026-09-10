-- AlterTable
ALTER TABLE `mp_unmatched_payments` MODIFY `status` ENUM('open', 'matched', 'dismissed', 'other_income', 'partial') NOT NULL DEFAULT 'open';

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `split_of_payment_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `payments_split_of_payment_id_idx` ON `payments`(`split_of_payment_id`);

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_split_of_payment_id_fkey` FOREIGN KEY (`split_of_payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
