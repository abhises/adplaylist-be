-- An ad can run in several markets. `market` stays as the primary (the
-- first one picked); `markets` lists all.
ALTER TABLE `ads` ADD COLUMN `markets` JSON NULL;
UPDATE `ads` SET `markets` = JSON_ARRAY(`market`);
