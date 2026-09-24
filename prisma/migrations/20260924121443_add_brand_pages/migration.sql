-- CreateTable
CREATE TABLE `brand_pages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(150) NOT NULL,
    `brand_name` VARCHAR(150) NOT NULL,
    `heading` VARCHAR(255) NOT NULL,
    `body_html` LONGTEXT NOT NULL,
    `cta_label` VARCHAR(100) NOT NULL DEFAULT 'Sign up',
    `published` BOOLEAN NOT NULL DEFAULT false,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL,

    UNIQUE INDEX `brand_pages_slug`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
