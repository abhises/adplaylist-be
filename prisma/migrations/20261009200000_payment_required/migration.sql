-- An owner who deleted their account and came back must subscribe (no new
-- trial) before using the app.
ALTER TABLE `accounts` ADD COLUMN `payment_required` BOOLEAN NOT NULL DEFAULT false;
