-- AlterTable
ALTER TABLE `action_tokens` MODIFY `purpose` ENUM('email_verification', 'password_invitation', 'password_reset', 'admin_invitation') NOT NULL;
