-- CreateTable
CREATE TABLE `contact_enquiries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `company` VARCHAR(255) NULL,
    `volume` VARCHAR(50) NULL,
    `message` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'new',
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `contact_enquiries_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_replies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enquiry_id` INTEGER NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `body` TEXT NOT NULL,
    `sent_by_id` INTEGER NULL,
    `sent_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_contact_replies_enquiry`(`enquiry_id`),
    INDEX `fk_contact_replies_user`(`sent_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `contact_replies` ADD CONSTRAINT `fk_contact_replies_enquiry` FOREIGN KEY (`enquiry_id`) REFERENCES `contact_enquiries`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `contact_replies` ADD CONSTRAINT `fk_contact_replies_user` FOREIGN KEY (`sent_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
