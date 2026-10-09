-- Ads copied from real, running ads ("Live ads"), as opposed to concepts.
ALTER TABLE `ads` ADD COLUMN `is_live` BOOLEAN NOT NULL DEFAULT false;
