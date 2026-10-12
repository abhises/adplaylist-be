-- The new credit model: a credit is now worth a fifth of what it was. An
-- image ad costs 5 credits (was 1), a video 10 (was 2), and every plan gives
-- five times the credits: Pro 50–200, Agency 250–750, and Starter 10.

-- What requests cost and what trials get, where admins change the defaults.
CREATE TABLE `credit_settings` (
  `key` VARCHAR(40) NOT NULL,
  `value` INTEGER NOT NULL,
  `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_by_id` INTEGER NULL,

  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Requests can ask for extra sizes (charged each) and for a revision of a
-- delivered request.
ALTER TABLE `creative_requests`
  ALTER COLUMN `credit_cost` SET DEFAULT 0,
  ADD COLUMN `extra_sizes` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `revision_of_id` INTEGER NULL;

-- Everything already counted in old credits is converted, so nobody loses
-- value: balances, the credit history, what open requests would refund, and
-- the credits each tier gives (and has given).
UPDATE `accounts` SET `credits` = `credits` * 5;
UPDATE `credit_transactions` SET `delta` = `delta` * 5, `balance` = `balance` * 5;
UPDATE `creative_requests` SET `credit_cost` = `credit_cost` * 5;
UPDATE `plan_prices` SET `credits` = `credits` * 5;
UPDATE `plan_price_changes`
  SET `credits` = `credits` * 5, `old_credits` = `old_credits` * 5;

-- Starter had no credits and now gives 10 a month. Paying Starter customers
-- get this month's straight away rather than at their next renewal.
UPDATE `plan_prices` SET `credits` = 10 WHERE `plan` = 'starter' AND `credits` = 0;
INSERT INTO `credit_transactions` (`account_id`, `reason`, `delta`, `balance`, `note`)
  SELECT `id`, 'adjustment', 10 - `credits`, 10, 'Starter now includes 10 credits a month'
  FROM `accounts`
  WHERE `plan` = 'starter' AND `status` = 'active' AND `credits` < 10;
UPDATE `accounts` SET `credits` = 10
  WHERE `plan` = 'starter' AND `status` = 'active' AND `credits` < 10;
