-- AlterTable
ALTER TABLE `credit_transactions` ADD COLUMN `stripe_invoice_id` VARCHAR(255) NULL;

-- CreateIndex
CREATE INDEX `credit_tx_invoice` ON `credit_transactions`(`stripe_invoice_id`);
