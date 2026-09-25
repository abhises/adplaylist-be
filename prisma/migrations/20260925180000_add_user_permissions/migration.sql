-- AlterTable
ALTER TABLE `users` ADD COLUMN `can_manage_blog` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `can_manage_brand_pages` BOOLEAN NOT NULL DEFAULT false;
