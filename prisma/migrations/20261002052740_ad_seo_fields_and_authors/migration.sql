-- AlterTable
ALTER TABLE `ads` ADD COLUMN `ad_format` VARCHAR(50) NULL,
    ADD COLUMN `author_id` INTEGER NULL,
    ADD COLUMN `content` JSON NULL,
    ADD COLUMN `date_added` DATE NULL,
    ADD COLUMN `date_updated` DATE NULL,
    ADD COLUMN `image_alt` VARCHAR(255) NULL,
    ADD COLUMN `image_caption` VARCHAR(500) NULL,
    ADD COLUMN `image_file_name` VARCHAR(255) NULL,
    ADD COLUMN `intro_paragraph` TEXT NULL,
    ADD COLUMN `meta_description` VARCHAR(500) NULL,
    ADD COLUMN `on_image_text` TEXT NULL,
    ADD COLUMN `page_headline` VARCHAR(255) NULL,
    ADD COLUMN `reviewer_id` INTEGER NULL,
    ADD COLUMN `seo_title` VARCHAR(255) NULL,
    ADD COLUMN `subcategory` VARCHAR(100) NULL,
    MODIFY `tags` TEXT NULL;

-- CreateTable
CREATE TABLE `ad_slug_redirects` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `old_slug` VARCHAR(150) NOT NULL,
    `ad_id` INTEGER NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `ad_slug_redirects_old_slug`(`old_slug`),
    INDEX `fk_ad_slug_redirects_ad`(`ad_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `authors` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(150) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `job_title` VARCHAR(255) NULL,
    `credentials` VARCHAR(255) NULL,
    `bio` TEXT NULL,
    `photo_url` VARCHAR(500) NULL,
    `linkedin_url` VARCHAR(500) NULL,
    `website_url` VARCHAR(500) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `authors_slug`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `fk_ads_author` ON `ads`(`author_id`);

-- CreateIndex
CREATE INDEX `fk_ads_reviewer` ON `ads`(`reviewer_id`);

-- AddForeignKey
ALTER TABLE `ads` ADD CONSTRAINT `fk_ads_author` FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `ads` ADD CONSTRAINT `fk_ads_reviewer` FOREIGN KEY (`reviewer_id`) REFERENCES `authors`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `ad_slug_redirects` ADD CONSTRAINT `fk_ad_slug_redirects_ad` FOREIGN KEY (`ad_id`) REFERENCES `ads`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
