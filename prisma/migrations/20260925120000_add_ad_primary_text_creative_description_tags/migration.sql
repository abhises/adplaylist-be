-- AlterTable
ALTER TABLE `ads` ADD COLUMN `primary_text` TEXT NULL,
    ADD COLUMN `creative_description` TEXT NULL,
    ADD COLUMN `tags` VARCHAR(500) NULL;
