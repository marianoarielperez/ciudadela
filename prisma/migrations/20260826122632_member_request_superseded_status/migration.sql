-- AlterTable
ALTER TABLE `member_requests` MODIFY `status` ENUM('pending', 'accepted', 'rejected', 'cancelled', 'superseded') NOT NULL DEFAULT 'pending';
