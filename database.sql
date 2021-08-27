CREATE TABLE `wallets` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user` BIGINT NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `address` VARCHAR(62) NOT NULL,
    `private_key` VARCHAR(64) NOT NULL,
    `public_key` VARCHAR(96) NOT NULL,
    `password` VARCHAR(64) NOT NULL,
    PRIMARY KEY (`id`)
);

CREATE TABLE `users` (
    `id` BIGINT NOT NULL,
    `wallet` INT,
    PRIMARY KEY (`id`)
);