-- Pages now show the clean image (photo_url) and the watermarked copy is
-- only for unpaid users' downloads. No live ad had an original stored yet,
-- so original_photo_url holds nothing to keep.
ALTER TABLE `ads` DROP COLUMN `original_photo_url`,
    ADD COLUMN `watermarked_photo_url` VARCHAR(500) NULL;
