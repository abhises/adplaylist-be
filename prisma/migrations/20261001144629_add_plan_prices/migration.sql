-- CreateTable
CREATE TABLE `plan_prices` (
    `plan` VARCHAR(20) NOT NULL,
    `volume` INTEGER NOT NULL,
    `monthly_cents` INTEGER NOT NULL,
    `yearly_cents` INTEGER NOT NULL,
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by_id` INTEGER NULL,

    PRIMARY KEY (`plan`, `volume`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Today's prices (the pricing-page redesign) as the starting point.
INSERT INTO `plan_prices` (`plan`, `volume`, `monthly_cents`, `yearly_cents`) VALUES
  ('starter', 0, 1500, 14400),
  ('pro', 10, 4900, 47040),
  ('pro', 20, 9500, 91200),
  ('pro', 30, 13900, 133440),
  ('pro', 40, 17900, 171840),
  ('agency', 50, 21500, 206400),
  ('agency', 70, 28900, 277440),
  ('agency', 100, 39900, 383040),
  ('agency', 150, 49900, 479040);
