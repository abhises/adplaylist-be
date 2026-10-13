-- Refer a friend: each account has a link (/?ref=<code>), and both sides get
-- bonus credits once the referred account pays its first invoice.
ALTER TABLE `accounts` ADD COLUMN `referral_code` VARCHAR(12) NULL;
CREATE UNIQUE INDEX `accounts_referral_code` ON `accounts`(`referral_code`);

CREATE TABLE `referrals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `referrer_account_id` INTEGER NOT NULL,
    `referred_account_id` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `note` VARCHAR(255) NULL,
    `referrer_credits` INTEGER NOT NULL DEFAULT 0,
    `referred_credits` INTEGER NOT NULL DEFAULT 0,
    `stripe_invoice_id` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `rewarded_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `referrals_referred_account`(`referred_account_id`),
    INDEX `referrals_referrer_status`(`referrer_account_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `referrals` ADD CONSTRAINT `fk_referrals_referrer` FOREIGN KEY (`referrer_account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `referrals` ADD CONSTRAINT `fk_referrals_referred` FOREIGN KEY (`referred_account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
