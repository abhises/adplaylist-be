-- AlterTable
ALTER TABLE `users` ADD COLUMN `google_id` VARCHAR(255) NULL,
    MODIFY `password_hash` VARCHAR(255) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `google_id` ON `users`(`google_id`);

