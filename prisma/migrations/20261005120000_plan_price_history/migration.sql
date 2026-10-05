-- A row per price change, so the pricing admin can show each price's history.
CREATE TABLE `plan_price_changes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `plan` VARCHAR(20) NOT NULL,
    `volume` INTEGER NOT NULL,
    `old_monthly_cents` INTEGER NULL,
    `old_yearly_cents` INTEGER NULL,
    `monthly_cents` INTEGER NOT NULL,
    `yearly_cents` INTEGER NOT NULL,
    `changed_by_id` INTEGER NULL,
    `changed_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `plan_price_changes_plan_volume_changed_at_idx`(`plan`, `volume`, `changed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Today's prices start the history, in effect since they were last set.
INSERT INTO `plan_price_changes` (`plan`, `volume`, `monthly_cents`, `yearly_cents`, `changed_by_id`, `changed_at`)
SELECT `plan`, `volume`, `monthly_cents`, `yearly_cents`, `updated_by_id`, `updated_at` FROM `plan_prices`;
