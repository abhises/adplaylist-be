-- CreateTable
CREATE TABLE `ads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(150) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `format` VARCHAR(100) NOT NULL,
    `variant` VARCHAR(20) NOT NULL,
    `eyebrow` VARCHAR(100) NULL,
    `headline` VARCHAR(255) NOT NULL,
    `sub` VARCHAR(255) NULL,
    `cta` VARCHAR(100) NULL,
    `badge` VARCHAR(100) NULL,
    `media_type` VARCHAR(10) NOT NULL,
    `swatch` VARCHAR(255) NOT NULL,
    `light` BOOLEAN NOT NULL DEFAULT false,
    `category` VARCHAR(100) NOT NULL,
    `market` VARCHAR(10) NOT NULL,
    `language` VARCHAR(50) NOT NULL DEFAULT 'English (EN)',
    `photo_url` VARCHAR(500) NULL,
    `platforms` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `editable` BOOLEAN NOT NULL DEFAULT false,
    `dominant_color` VARCHAR(30) NULL,
    `video_length` VARCHAR(20) NULL,
    `canva_url` VARCHAR(500) NULL,

    UNIQUE INDEX `slug`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `creative_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `type` VARCHAR(50) NOT NULL DEFAULT 'New creative',
    `size_needed` VARCHAR(150) NULL,
    `needed_by` DATE NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'Open',
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `reason` TEXT NULL,
    `ad_id` INTEGER NULL,
    `attachment_url` VARCHAR(500) NULL,
    `attachment_name` VARCHAR(255) NULL,

    INDEX `fk_requests_ad`(`ad_id`),
    INDEX `fk_requests_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `saved_ads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `ad_id` INTEGER NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_saved_ads_ad`(`ad_id`),
    UNIQUE INDEX `uniq_user_ad`(`user_id`, `ad_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `full_name` VARCHAR(255) NOT NULL,
    `default_language` VARCHAR(50) NOT NULL DEFAULT 'English (EN)',
    `grid_density` VARCHAR(20) NOT NULL DEFAULT 'Comfortable',
    `pref_onboarding` BOOLEAN NOT NULL DEFAULT true,
    `pref_product` BOOLEAN NOT NULL DEFAULT true,
    `pref_promotions` BOOLEAN NOT NULL DEFAULT false,
    `pref_brand` BOOLEAN NOT NULL DEFAULT true,
    `pref_newsletter` BOOLEAN NOT NULL DEFAULT false,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `email`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `creative_requests` ADD CONSTRAINT `fk_requests_ad` FOREIGN KEY (`ad_id`) REFERENCES `ads`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `creative_requests` ADD CONSTRAINT `fk_requests_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `saved_ads` ADD CONSTRAINT `fk_saved_ads_ad` FOREIGN KEY (`ad_id`) REFERENCES `ads`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `saved_ads` ADD CONSTRAINT `fk_saved_ads_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

