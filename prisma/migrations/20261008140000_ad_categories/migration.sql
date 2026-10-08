-- An ad can sit in several categories. `category` stays as the primary (the
-- first one picked) for breadcrumbs and page titles; `categories` lists all.
ALTER TABLE `ads` ADD COLUMN `categories` JSON NULL;
UPDATE `ads` SET `categories` = JSON_ARRAY(`category`);
