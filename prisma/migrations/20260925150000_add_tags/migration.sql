-- CreateTable
CREATE TABLE `tags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `tag_name`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed the starting tag list
INSERT INTO `tags` (`name`) VALUES
    ('auto insurance'),
    ('price comparison'),
    ('save money'),
    ('insurance quote'),
    ('performance marketing'),
    ('lead gen'),
    ('finance offer'),
    ('discount ad');
