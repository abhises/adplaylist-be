-- Requests can ask for images, a video or both. A video costs 2 credits, so
-- each request records what it cost (what a decline gives back).
ALTER TABLE `creative_requests`
  MODIFY `size_needed` VARCHAR(255) NULL,
  ADD COLUMN `media` VARCHAR(20) NULL,
  ADD COLUMN `credit_cost` INTEGER NOT NULL DEFAULT 1;

-- Video ads: the MP4 and its pixel size. photo_url is the video's cover.
ALTER TABLE `ads`
  ADD COLUMN `video_url` VARCHAR(500) NULL,
  ADD COLUMN `video_width` INTEGER NULL,
  ADD COLUMN `video_height` INTEGER NULL;
