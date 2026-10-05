-- Each tier's credits a month become editable. They start equal to the
-- volume, which stays the tier's fixed id.
ALTER TABLE `plan_prices` ADD COLUMN `credits` INTEGER NULL;
UPDATE `plan_prices` SET `credits` = `volume`;
ALTER TABLE `plan_prices` MODIFY `credits` INTEGER NOT NULL;

ALTER TABLE `plan_price_changes` ADD COLUMN `old_credits` INTEGER NULL,
    ADD COLUMN `credits` INTEGER NULL;
UPDATE `plan_price_changes` SET `credits` = `volume`,
    `old_credits` = IF(`old_monthly_cents` IS NULL, NULL, `volume`);
ALTER TABLE `plan_price_changes` MODIFY `credits` INTEGER NOT NULL;
