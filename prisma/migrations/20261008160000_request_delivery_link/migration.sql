-- Delivering a request links the finished creative (a Canva, Drive or
-- Adplaylist ad URL) and an optional message to the client.
ALTER TABLE `creative_requests`
  ADD COLUMN `delivered_url` VARCHAR(1000) NULL,
  ADD COLUMN `delivery_note` TEXT NULL;
