-- CreateTable
CREATE TABLE `credit_transactions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NOT NULL,
    `reason` VARCHAR(20) NOT NULL,
    `delta` INTEGER NOT NULL,
    `balance` INTEGER NOT NULL,
    `note` VARCHAR(255) NULL,
    `request_id` INTEGER NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `credit_tx_account_created`(`account_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `credit_transactions` ADD CONSTRAINT `fk_credit_tx_account` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- Accounts that already hold credits start their history with them, so the
-- totals match the balance.
INSERT INTO `credit_transactions` (`account_id`, `reason`, `delta`, `balance`, `note`)
SELECT `id`, 'adjustment', `credits`, `credits`, 'Opening balance'
FROM `accounts`
WHERE `credits` > 0;
