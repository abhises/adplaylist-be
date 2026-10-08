-- The link to the ad a request is about, so the team knows which creative
-- the client means.
ALTER TABLE `creative_requests` ADD COLUMN `ad_url` VARCHAR(1000) NULL;
