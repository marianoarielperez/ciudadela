-- AlterTable
ALTER TABLE `memberships` ADD COLUMN `category_at_close` ENUM('active', 'adherent', 'collaborator', 'cadet', 'honorary', 'lifetime') NULL,
    ADD COLUMN `status_at_close` ENUM('active', 'suspended', 'withdrawn') NULL;
