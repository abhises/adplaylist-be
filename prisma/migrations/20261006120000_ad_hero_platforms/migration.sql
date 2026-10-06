-- The hero panel now has a tab per platform; ads are picked for specific tabs.
ALTER TABLE `ads` ADD COLUMN `hero_platforms` VARCHAR(100) NOT NULL DEFAULT '';

-- Existing hero picks go in the Meta tab.
UPDATE `ads` SET `hero_platforms` = 'META' WHERE `show_in_hero` = true;

ALTER TABLE `ads` DROP COLUMN `show_in_hero`;
