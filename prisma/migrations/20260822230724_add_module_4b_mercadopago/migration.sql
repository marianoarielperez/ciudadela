/*
  Warnings:

  - Added the required column `reason` to the `mp_unmatched_payments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `mp_subscriptions` MODIFY `plan_id` VARCHAR(64) NULL,
    MODIFY `payer_email` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `mp_unmatched_payments` ADD COLUMN `preapproval_id` VARCHAR(64) NULL,
    ADD COLUMN `reason` VARCHAR(32) NOT NULL;

-- CreateIndex
CREATE INDEX `mp_unmatched_payments_preapproval_id_idx` ON `mp_unmatched_payments`(`preapproval_id`);
