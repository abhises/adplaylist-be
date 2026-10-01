-- AlterTable
ALTER TABLE `creative_requests` ADD COLUMN `account_id` INTEGER NULL,
    ADD COLUMN `credit_charged` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `account_id` INTEGER NULL,
    ADD COLUMN `account_role` VARCHAR(10) NULL;

-- CreateTable
CREATE TABLE `accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `plan` VARCHAR(20) NOT NULL DEFAULT 'starter',
    `credit_volume` INTEGER NOT NULL DEFAULT 0,
    `billing_cycle` VARCHAR(10) NOT NULL DEFAULT 'monthly',
    `status` VARCHAR(20) NOT NULL DEFAULT 'trial',
    `trial_ends_at` DATETIME(0) NULL,
    `current_period_end` DATETIME(0) NULL,
    `past_due_since` DATETIME(0) NULL,
    `credits` INTEGER NOT NULL DEFAULT 0,
    `next_refill_at` DATETIME(0) NULL,
    `stripe_customer_id` VARCHAR(255) NULL,
    `stripe_subscription_id` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `accounts_stripe_customer`(`stripe_customer_id`),
    UNIQUE INDEX `accounts_stripe_subscription`(`stripe_subscription_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stripe_events` (
    `id` VARCHAR(255) NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `fk_requests_account` ON `creative_requests`(`account_id`);

-- CreateIndex
CREATE INDEX `fk_users_account` ON `users`(`account_id`);

-- AddForeignKey
ALTER TABLE `creative_requests` ADD CONSTRAINT `fk_requests_account` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `fk_users_account` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- Every existing client becomes the owner of their own account, starting a
-- 7-day Starter trial from the day this runs. Staff (designer, editor,
-- admin) don't get one: they never use a seat. Reusing the user's id as the
-- account id keeps the link step below a plain join-free UPDATE.
INSERT INTO `accounts` (`id`, `name`, `plan`, `credit_volume`, `billing_cycle`, `status`, `trial_ends_at`, `credits`)
SELECT `id`, `full_name`, 'starter', 0, 'monthly', 'trial', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY), 0
FROM `users`
WHERE `role` = 'client';

UPDATE `users` SET `account_id` = `id`, `account_role` = 'owner' WHERE `role` = 'client';
