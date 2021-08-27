import axios from 'axios';
import {
    Client,
    CommandInteraction,
    Intents,
    SelectMenuInteraction,
} from 'discord.js';
import db from './database';

export const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.DIRECT_MESSAGES,
    ],
    partials: ['CHANNEL'],
});

client.once('ready', async () => {
    client.user!.setPresence({
        activities: [
            {
                type: 'LISTENING',
                name: 'the Arbor Wallet',
            },
        ],
    });
    console.log(`${client.user!.tag} is now ready to be used.`);
});

async function ensureUser(id: string) {
    const [[{ count }]]: [[{ count: string }]] = (await db.execute(
        'SELECT COUNT(*) AS `count` FROM `users` WHERE `id` = ?',
        [id]
    )) as any;
    if (+count === 0)
        await db.execute('INSERT INTO `users` (`id`) VALUES (?)', [id]);
}

client.on('interactionCreate', async (interaction) => {
    if (interaction instanceof CommandInteraction) {
        try {
            switch (interaction.commandName) {
                case 'create': {
                    const name = interaction.options.getString('wallet', true);
                    if (name.length > 64)
                        return await interaction.reply(
                            'The wallet name must be 64 characters or less.'
                        );
                    const [[{ count }]]: [[{ count: string }]] =
                        (await db.execute(
                            'SELECT COUNT(*) AS `count` FROM `wallets` WHERE `user` = ? AND `name` = ?',
                            [interaction.user.id, name]
                        )) as any;
                    if (+count > 0)
                        return await interaction.reply(
                            'You already have a wallet with that name.'
                        );
                    let dm;
                    try {
                        dm = await interaction.user.createDM();
                        await dm.send(
                            'What password do you want to use for this wallet?'
                        );
                    } catch {
                        return await interaction.reply(
                            'Could not open your direct messages.'
                        );
                    }
                    await interaction.reply(
                        'Check your direct messages to continue.'
                    );
                    let password;
                    try {
                        const result = await dm.awaitMessages({
                            errors: ['time'],
                            time: 120000,
                            max: 1,
                        });
                        password = result.first()!;
                    } catch {
                        await dm.send(
                            'The command has been cancelled due to inactivity.'
                        );
                        return;
                    }
                    if (password.content.length > 64) {
                        await password.reply(
                            'The password must be 64 characters or less.'
                        );
                        return;
                    }
                    const {
                        data: {
                            success: keygenSuccess,
                            phrase,
                            private_key,
                            public_key,
                        },
                    } = await axios.get(
                        `${
                            process.env.ARBOR_API ?? 'https://localhost/api/v1'
                        }/keygen`
                    );
                    if (!keygenSuccess) {
                        await dm.send('Could not generate the keypair.');
                        return;
                    }
                    const {
                        data: { success: walletSuccess, address },
                    } = await axios.get(
                        `${
                            process.env.ARBOR_API ?? 'https://localhost/api/v1'
                        }/wallet`,
                        {
                            data: {
                                public_key,
                                fork: 'xch',
                            },
                        }
                    );
                    if (!keygenSuccess) {
                        await dm.send('Could not create the wallet.');
                        return;
                    }
                    const phraseMessage = await dm.send({
                        content: `Write this recovery phrase down somewhere then delete this message: ${phrase}`,
                        components: [
                            {
                                type: 'ACTION_ROW',
                                components: [
                                    {
                                        type: 'BUTTON',
                                        customId: 'delete',
                                        label: 'Delete',
                                        style: 'DANGER',
                                    },
                                ],
                            },
                        ],
                    });
                    await phraseMessage.awaitMessageComponent({
                        filter: (interaction) =>
                            interaction.customId === 'delete',
                    });
                    await phraseMessage.delete();
                    const [result]: any[] = await db.execute(
                        'INSERT INTO `wallets` (`user`, `name`, `address`, `private_key`, `public_key`, `password`) VALUES (?, ?, ?, ?, ?, ?)',
                        [
                            interaction.user.id,
                            name,
                            address,
                            private_key,
                            public_key,
                            password.content,
                        ]
                    );
                    await ensureUser(interaction.user.id);
                    await db.execute(
                        'UPDATE `users` SET `wallet` = ? WHERE `id` = ?',
                        [result.insertId.toString(), interaction.user.id]
                    );
                    await dm.send(
                        `Your wallet has been created with this address: ${address}`
                    );
                    break;
                }
                case 'delete': {
                    const name = interaction.options.getString('wallet', true);
                    if (name.length > 64)
                        return await interaction.reply(
                            'The wallet name must be 64 characters or less.'
                        );
                    const [[wallet]]: [[any]] = (await db.execute(
                        'SELECT * FROM `wallets` WHERE `user` = ? AND `name` = ?',
                        [interaction.user.id, name]
                    )) as any;
                    if (!wallet)
                        return await interaction.reply(
                            "You don't have a wallet with that name."
                        );
                    let dm;
                    try {
                        dm = await interaction.user.createDM();
                        await dm.send(
                            `What is the password for the ${wallet.name} wallet?`
                        );
                    } catch {
                        return await interaction.reply(
                            'Could not open your direct messages.'
                        );
                    }
                    await interaction.reply(
                        'Check your direct messages to continue.'
                    );
                    let password;
                    try {
                        const result = await dm.awaitMessages({
                            errors: ['time'],
                            time: 120000,
                            max: 1,
                        });
                        password = result.first()!;
                    } catch {
                        await dm.send(
                            'The command has been cancelled due to inactivity.'
                        );
                        return;
                    }
                    if (password.content.length > 64) {
                        await password.reply(
                            'The password must be 64 characters or less.'
                        );
                        return;
                    }
                    if (password.content !== wallet.password) {
                        await dm.send('That is not the correct password.');
                        return;
                    }
                    await db.execute('DELETE FROM `wallets` WHERE `id` = ?', [
                        wallet.id,
                    ]);
                    await dm.send(
                        `Your wallet has been deleted with this address: ${wallet.address}`
                    );
                    break;
                }
                case 'recover': {
                    const name = interaction.options.getString('name', true);
                    if (name.length > 64)
                        return await interaction.reply(
                            'The wallet name must be 64 characters or less.'
                        );
                    const [[{ count }]]: [[{ count: string }]] =
                        (await db.execute(
                            'SELECT COUNT(*) AS `count` FROM `wallets` WHERE `user` = ? AND `name` = ?',
                            [interaction.user.id, name]
                        )) as any;
                    if (+count > 0)
                        return await interaction.reply(
                            'You already have a wallet with that name.'
                        );
                    let dm;
                    try {
                        dm = await interaction.user.createDM();
                        await dm.send(
                            'What is the mnemonic phrase you would like to recover?'
                        );
                    } catch {
                        return await interaction.reply(
                            'Could not open your direct messages.'
                        );
                    }
                    await interaction.reply(
                        'Check your direct messages to continue.'
                    );
                    let phrase;
                    try {
                        const result = await dm.awaitMessages({
                            errors: ['time'],
                            time: 120000,
                            max: 1,
                        });
                        phrase = result.first()!;
                    } catch {
                        await dm.send(
                            'The command has been cancelled due to inactivity.'
                        );
                        return;
                    }
                    await dm.send(
                        'What password do you want to use for this wallet?'
                    );
                    let password;
                    try {
                        const result = await dm.awaitMessages({
                            errors: ['time'],
                            time: 120000,
                            max: 1,
                        });
                        password = result.first()!;
                    } catch {
                        await dm.send(
                            'The command has been cancelled due to inactivity.'
                        );
                        return;
                    }
                    if (password.content.length > 64) {
                        await password.reply(
                            'The password must be 64 characters or less.'
                        );
                        return;
                    }
                    const {
                        data: {
                            success: recoverSuccess,
                            private_key,
                            public_key,
                        },
                    } = await axios.get(
                        `${
                            process.env.ARBOR_API ?? 'https://localhost/api/v1'
                        }/recover`,
                        {
                            data: {
                                phrase: phrase.content,
                            },
                        }
                    );
                    if (!recoverSuccess) {
                        await dm.send('Could not recover the keypair.');
                        return;
                    }
                    const {
                        data: { success: walletSuccess, address },
                    } = await axios.get(
                        `${
                            process.env.ARBOR_API ?? 'https://localhost/api/v1'
                        }/wallet`,
                        {
                            data: {
                                public_key,
                                fork: 'xch',
                            },
                        }
                    );
                    if (!walletSuccess) {
                        await dm.send('Could not recover the wallet.');
                        return;
                    }
                    const [result]: any[] = await db.execute(
                        'INSERT INTO `wallets` (`user`, `name`, `address`, `private_key`, `public_key`, `password`) VALUES (?, ?, ?, ?, ?, ?)',
                        [
                            interaction.user.id,
                            name,
                            address,
                            private_key,
                            public_key,
                            password.content,
                        ]
                    );
                    await ensureUser(interaction.user.id);
                    await db.execute(
                        'UPDATE `users` SET `wallet` = ? WHERE `id` = ?',
                        [result.insertId.toString(), interaction.user.id]
                    );
                    await dm.send(
                        `Your wallet has been recovered with this address: ${address}`
                    );
                    break;
                }
                case 'wallet': {
                    const [wallets]: any[][] = await db.execute(
                        'SELECT * FROM `wallets` WHERE `user` = ?',
                        [interaction.user.id]
                    );
                    const [[user]]: any = await db.execute(
                        'SELECT * FROM `users` WHERE `id` = ?',
                        [interaction.user.id]
                    );
                    if (!user || !wallets.length)
                        return await interaction.reply(
                            'You have not created an Arbor wallet.'
                        );
                    let dm;
                    try {
                        dm = await interaction.user.createDM();
                    } catch {
                        return await interaction.reply(
                            'Could not open your direct messages.'
                        );
                    }
                    await interaction.reply(
                        'Check your direct messages to continue.'
                    );
                    const message = await dm.send({
                        content: 'Select which wallet to use.',
                        components: [
                            {
                                type: 'ACTION_ROW',
                                components: [
                                    {
                                        type: 'SELECT_MENU',
                                        customId: 'wallet',
                                        placeholder: 'Select wallet',
                                        options: wallets.map((wallet: any) => {
                                            return {
                                                label: wallet.name,
                                                value: wallet.name,
                                                default:
                                                    wallet.id === user.wallet,
                                                description: wallet.address,
                                            };
                                        }),
                                    },
                                ],
                            },
                        ],
                    });
                    const newInteraction = await dm.awaitMessageComponent({
                        filter: (newInteraction) =>
                            newInteraction.customId === 'wallet' &&
                            newInteraction.user.id === interaction.user.id,
                    });
                    if (!(newInteraction instanceof SelectMenuInteraction))
                        return;
                    await message.edit({
                        components: [
                            {
                                type: 'ACTION_ROW',
                                components: [
                                    {
                                        type: 'SELECT_MENU',
                                        customId: 'wallet',
                                        placeholder: 'Select wallet',
                                        options: wallets.map((wallet: any) => {
                                            return {
                                                label: wallet.name,
                                                value: wallet.name,
                                                default:
                                                    wallet.name ===
                                                    newInteraction.values[0],
                                                description: wallet.address,
                                            };
                                        }),
                                        disabled: true,
                                    },
                                ],
                            },
                        ],
                    });
                    await newInteraction.reply(
                        `Now using the wallet you selected: ${newInteraction.values[0]}`
                    );
                    const [[{ id }]]: [[{ id: number }]] = (await db.execute(
                        'SELECT `id` FROM `wallets` WHERE `name` = ? AND `user` = ?',
                        [newInteraction.values[0], newInteraction.user.id]
                    )) as any;
                    await db.execute(
                        'UPDATE `users` SET `wallet` = ? WHERE `id` = ?',
                        [id.toString(), newInteraction.user.id]
                    );
                    break;
                }
                case 'balance': {
                    const [[wallet]]: [[any]] = (await db.execute(
                        'SELECT * FROM `wallets` WHERE `id` = (SELECT `wallet` FROM `users` WHERE `id` = ?)',
                        [interaction.user.id]
                    )) as any;
                    if (!wallet)
                        return await interaction.reply(
                            'No wallet is currently selected.'
                        );
                    const {
                        data: { success: balanceSuccess, balance, fork },
                    } = await axios.get(
                        `${
                            process.env.ARBOR_API ?? 'https://localhost/api/v1'
                        }/balance`,
                        {
                            data: {
                                address: wallet.address,
                            },
                        }
                    );
                    if (!balanceSuccess)
                        return await interaction.reply(
                            'Could not fetch the balance.'
                        );
                    let dm;
                    try {
                        dm = await interaction.user.createDM();
                    } catch {
                        return await interaction.reply(
                            'Could not open your direct messages.'
                        );
                    }
                    await interaction.reply(
                        'Check your direct messages to continue.'
                    );
                    await dm.send(
                        `Your wallet currently has ${(
                            balance *
                            10 ** -fork.precision
                        )
                            .toFixed(fork.precision)
                            .replace(/\.?0+$/, '')} XCH.`
                    );
                    break;
                }
                case 'receive': {
                    const [[wallet]]: [[any]] = (await db.execute(
                        'SELECT * FROM `wallets` WHERE `id` = (SELECT `wallet` FROM `users` WHERE `id` = ?)',
                        [interaction.user.id]
                    )) as any;
                    if (!wallet)
                        return await interaction.reply(
                            'No wallet is currently selected.'
                        );
                    let dm;
                    try {
                        dm = await interaction.user.createDM();
                    } catch {
                        return await interaction.reply(
                            'Could not open your direct messages.'
                        );
                    }
                    await interaction.reply(
                        'Check your direct messages to continue.'
                    );
                    await dm.send(
                        `Your receive address for this wallet: ${wallet.address}`
                    );
                    break;
                }
                case 'transactions': {
                    const [[wallet]]: [[any]] = (await db.execute(
                        'SELECT * FROM `wallets` WHERE `id` = (SELECT `wallet` FROM `users` WHERE `id` = ?)',
                        [interaction.user.id]
                    )) as any;
                    if (!wallet)
                        return await interaction.reply(
                            'No wallet is currently selected.'
                        );
                    const {
                        data: {
                            success: transactionsSuccess,
                            transactions,
                            fork,
                        },
                    } = await axios.get(
                        `${
                            process.env.ARBOR_API ?? 'https://localhost/api/v1'
                        }/transactions`,
                        {
                            data: {
                                address: wallet.address,
                            },
                        }
                    );
                    if (!transactionsSuccess)
                        return await interaction.reply(
                            'Could not fetch the transactions.'
                        );
                    if (!transactions.length)
                        return await interaction.reply(
                            'There are no transactions on this wallet yet.'
                        );
                    const pages: any[][] = [[]];
                    for (const transaction of transactions) {
                        let page = pages[pages.length - 1];
                        if (page.length >= 10) {
                            page = [];
                            pages.push(page);
                        }
                        page.push(transaction);
                    }
                    let page = 0;
                    const makePage = (page: number) => {
                        return {
                            content: pages[page]
                                .map((transaction, i) => {
                                    return `**${
                                        transactions.length - (page * 10 + i)
                                    }.** <t:${transaction.timestamp}> **${
                                        transaction.type === 'send'
                                            ? 'Sent'
                                            : 'Received'
                                    } ${(
                                        transaction.amount *
                                        10 ** -fork.precision
                                    )
                                        .toFixed(fork.precision)
                                        .replace(/\.?0+$/, '')} XCH**\n${
                                        transaction.type === 'send'
                                            ? `**To** ${transaction.destination}`
                                            : `**From** ${transaction.sender}`
                                    }`;
                                })
                                .join('\n\n'),
                        };
                    };
                    let dm;
                    try {
                        dm = await interaction.user.createDM();
                    } catch {
                        return await interaction.reply(
                            'Could not open your direct messages.'
                        );
                    }
                    await interaction.reply(
                        'Check your direct messages to continue.'
                    );
                    await dm.send(makePage(page));
                    break;
                }
                case 'send': {
                    const amount = interaction.options.getString(
                        'amount',
                        true
                    );
                    const destination = interaction.options.getString(
                        'destination',
                        true
                    );
                    const [[wallet]]: [[any]] = (await db.execute(
                        'SELECT * FROM `wallets` WHERE `id` = (SELECT `wallet` FROM `users` WHERE `id` = ?)',
                        [interaction.user.id]
                    )) as any;
                    if (!wallet) {
                        return await interaction.reply(
                            'No wallet is currently selected.'
                        );
                    }
                    let dm;
                    try {
                        dm = await interaction.user.createDM();
                        await dm.send(
                            `What is the password for the ${wallet.name} wallet?`
                        );
                    } catch {
                        return await interaction.reply(
                            'Could not open your direct messages.'
                        );
                    }
                    await interaction.reply(
                        'Check your direct messages to continue.'
                    );
                    let password;
                    try {
                        const result = await dm.awaitMessages({
                            errors: ['time'],
                            time: 120000,
                            max: 1,
                        });
                        password = result.first()!;
                    } catch {
                        await dm.send(
                            'The command has been cancelled due to inactivity.'
                        );
                        return;
                    }
                    if (password.content.length > 64) {
                        await password.reply(
                            'The password must be 64 characters or less.'
                        );
                        return;
                    }
                    if (password.content !== wallet.password) {
                        await dm.send('That is not the correct password.');
                        return;
                    }
                    const {
                        data: { success: sendSuccess, error: sendError },
                    } = await axios.get(
                        `${
                            process.env.ARBOR_API ?? 'https://localhost/api/v1'
                        }/send`,
                        {
                            data: {
                                private_key: wallet.private_key,
                                amount: +amount * 10 ** 12,
                                destination,
                            },
                        }
                    );
                    if (!sendSuccess) {
                        await dm.send(
                            `Could not complete the transaction: ${sendError}`
                        );
                        return;
                    }
                    await dm.send(
                        `Sent ${amount.replace(
                            /\.?0+$/,
                            ''
                        )} XCH to: ${destination}`
                    );
                    break;
                }
            }
        } catch (error) {
            console.error(error);
        }
    }
});

client.login(process.env.DISCORD_API_TOKEN);
