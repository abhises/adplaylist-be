-- Brand pages made from a brand CSV: the structured page content, and the
-- key that lets an outreach link show the page's ads without signing in.
ALTER TABLE `brand_pages` ADD COLUMN `profile` JSON NULL;
ALTER TABLE `brand_pages` ADD COLUMN `access_key` VARCHAR(32) NULL;
