-- "Delete account" deactivates rather than erases.
ALTER TABLE `users` ADD COLUMN `deactivated_at` TIMESTAMP(0) NULL;

-- Discounts claimed from the "Before you go" offer (25%, then 10%, then none).
ALTER TABLE `accounts` ADD COLUMN `retention_offers_used` INTEGER NOT NULL DEFAULT 0;

-- What happened each time someone went through "Delete account".
CREATE TABLE `cancellation_feedback` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `account_id` INTEGER NULL,
    `user_name` VARCHAR(255) NOT NULL,
    `user_email` VARCHAR(255) NOT NULL,
    `account_name` VARCHAR(255) NULL,
    `plan` VARCHAR(20) NULL,
    `offer_percent` INTEGER NULL,
    `outcome` VARCHAR(20) NOT NULL,
    `reason` VARCHAR(100) NULL,
    `details` TEXT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_cancellations_user`(`user_id`),
    INDEX `fk_cancellations_account`(`account_id`),
    INDEX `cancellations_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cancellation_feedback` ADD CONSTRAINT `fk_cancellations_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE `cancellation_feedback` ADD CONSTRAINT `fk_cancellations_account` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
