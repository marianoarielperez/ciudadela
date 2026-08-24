-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `period` CHAR(7) NULL;

-- CreateIndex
CREATE INDEX `audit_log_action_idx` ON `audit_log`(`action`);

-- CreateIndex
CREATE INDEX `notifications_status_idx` ON `notifications`(`status`);

-- CreateIndex
CREATE INDEX `notifications_type_period_idx` ON `notifications`(`type`, `period`);

-- CreateIndex
CREATE INDEX `webhook_events_origin_received_at_idx` ON `webhook_events`(`origin`, `received_at`);
