import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events
} from 'discord.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const PORT = Number(process.env.PORT || 3000);
const NEWS_MINUTES = Math.max(5, Number(process.env.NEWS_MINUTES || 30));
const DATA_DIR = process.env.DATA_DIR || './data';
const STATE_FILE = path.join(DATA_DIR, 'state.json');

if (!TOKEN || !GUILD_ID || !CLIENT_ID) {
  console.error('Missing required environment variables: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_CLIENT_ID');
  process.exit(1);
}

const app = express();
let clientReady = false;
let botTag = null;
let guildName = null;
let newsTimer = null;
const startedAt = Date.now();

app.get('/', (_req, res) => {
  res.type('html').send(`
    <h1>AION 2 Israel Community Bot v6</h1>
    <p>Status: ${clientReady ? 'online' : 'starting'}</p>
    <p>Bot: ${botTag ?? '-'}</p>
    <p>Guild: ${guildName ?? '-'}</p>
  `);
});

app.get('/health', (_req, res) => {
  if (!clientReady) return res.status(503).json({ ok: false, status: 'starting' });
  res.json({ ok: true, status: 'online', bot: botTag, guild: guildName });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[http] listening on 0.0.0.0:${PORT}`);
});

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Show AION 2 Israel bot commands'),
  new SlashCommandBuilder().setName('server').setDescription('Show official community server information'),
  new SlashCommandBuilder().setName('status').setDescription('Show bot/community status'),
  new SlashCommandBuilder().setName('rules').setDescription('Show the community rules channel'),
  new SlashCommandBuilder().setName('ping').setDescription('Check whether the community bot is online'),
  new SlashCommandBuilder().setName('voice').setDescription('Show community voice channels'),

  new SlashCommandBuilder()
    .setName('setserver')
    .setDescription('Staff: set the official AION 2 community server')
    .addStringOption(o => o.setName('server').setDescription('Exact server name').setRequired(true))
    .addStringOption(o => o.setName('faction').setDescription('Asmodian / Elyos').setRequired(false))
    .addStringOption(o => o.setName('region').setDescription('Europe / NA / etc.').setRequired(false)),

  new SlashCommandBuilder()
    .setName('lfg')
    .setDescription('Post a formatted Looking For Group message')
    .addStringOption(o => o.setName('activity').setDescription('Dungeon / PvP / Boss / etc.').setRequired(true))
    .addStringOption(o => o.setName('class').setDescription('Your class or role').setRequired(true))
    .addStringOption(o => o.setName('need').setDescription('What players you need').setRequired(true))
    .addStringOption(o => o.setName('faction').setDescription('Asmodian / Elyos').setRequired(true))
    .addStringOption(o => o.setName('voice').setDescription('Yes / No').setRequired(false))
    .addStringOption(o => o.setName('time').setDescription('Now / 20:00 / etc.').setRequired(false)),

  new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create a formatted community event post')
    .addStringOption(o => o.setName('title').setDescription('Event title').setRequired(true))
    .addStringOption(o => o.setName('when').setDescription('When it happens').setRequired(true))
    .addStringOption(o => o.setName('details').setDescription('Event details').setRequired(true)),

  new SlashCommandBuilder().setName('report').setDescription('Privately report a member or issue to staff'),
  new SlashCommandBuilder().setName('news').setDescription('Check official NCSoft AION 2 news now'),

  new SlashCommandBuilder()
    .setName('build')
    .setDescription('Create a structured build post in the builds forum')
    .addStringOption(o => o.setName('title').setDescription('Build title').setRequired(true))
    .addStringOption(o => o.setName('class').setDescription('Class name').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('PvE / PvP / Leveling / Endgame').setRequired(true))
    .addStringOption(o => o.setName('level').setDescription('Level / gear score / progression').setRequired(false))
    .addStringOption(o => o.setName('gear').setDescription('Gear notes').setRequired(false))
    .addStringOption(o => o.setName('skills').setDescription('Skills / rotation').setRequired(false))
    .addStringOption(o => o.setName('notes').setDescription('Extra notes').setRequired(false)),

  new SlashCommandBuilder()
    .setName('question')
    .setDescription('Create a structured help post in the questions forum')
    .addStringOption(o => o.setName('title').setDescription('Short question title').setRequired(true))
    .addStringOption(o => o.setName('category').setDescription('Quest / Class / Gear / PvE / PvP / Technical / Server').setRequired(true))
    .addStringOption(o => o.setName('details').setDescription('Full question').setRequired(true))
].map(c => c.toJSON());

const cfg = {
  channels: {
    welcome: 'welcome',
    rules: 'rules',
    serverInfo: 'server-info',
    botCommands: 'bot-commands',
    generalHe: 'general-עברית',
    lfg: 'looking-for-group',
    builds: 'builds-and-classes',
    questions: 'questions-help',
    aionNews: 'aion-news',
    modLog: 'mod-log',
    reports: 'reports',
    eventInfo: 'event-info'
  }
};

function ch(guild, name) {
  return guild.channels.cache.find(c => c.name === name);
}

async function loadState() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    return {
      seenNews: state.seenNews || [],
      lastNewsCheck: state.lastNewsCheck || null,
      server: state.server || 'TO BE CONFIRMED',
      faction: state.faction || 'Asmodian',
      region: state.region || 'Europe'
    };
  } catch {
    return {
      seenNews: [],
      lastNewsCheck: null,
      server: 'TO BE CONFIRMED',
      faction: 'Asmodian',
      region: 'Europe'
    };
  }
}

async function saveState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log(`[commands] registered ${commands.length} guild commands`);
}

async function sendLog(guild, title, description) {
  const c = ch(guild, cfg.channels.modLog);
  if (!c?.isTextBased()) return;
  try {
    await c.send({
      embeds: [new EmbedBuilder().setTitle(title).setDescription(description.slice(0, 3900)).setTimestamp()]
    });
  } catch (err) {
    console.error('[log]', err.message);
  }
}

async function ensureBotCommandsPanel(client, guild) {
  const channel = ch(guild, cfg.channels.botCommands);
  if (!channel?.isTextBased()) return;

  const marker = 'AION2-IL-BOT-COMMANDS-v6';
  let existing;
  try {
    const msgs = await channel.messages.fetch({ limit: 50 });
    existing = msgs.find(m => m.author.id === client.user.id && m.content.includes(marker));
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle('🤖 AION 2 Israel Community Bot')
    .setDescription(
`Use these commands anywhere in the server:

**/server** — official region, faction and selected server
**/status** — bot/community status
**/rules** — links to the community rules
**/voice** — lists available voice channels
**/lfg** — creates a formatted Looking For Group post
**/build** — creates a structured post in #builds-and-classes
**/question** — creates a structured post in #questions-help
**/news** — checks official AION 2 news
**/report** — privately reports an issue to staff
**/event** — staff-only community event post
**/setserver** — staff-only server selection update
**/ping** — checks if the bot is online

**Quick tips**
• Use **/lfg** when looking for a group.
• Use **/build** for clean build posts.
• Use **/question** for help topics.
• Use **/report** instead of arguing publicly.
• Use **/help** at any time.`
    );

  const payload = {
    content: `||${marker}||`,
    embeds: [embed]
  };

  if (existing) {
    await existing.edit(payload);
  } else {
    const msg = await channel.send(payload);
    try { await msg.pin(); } catch {}
  }
}

async function ensureWelcomeHint(client, guild) {
  const channel = ch(guild, cfg.channels.welcome);
  if (!channel?.isTextBased()) return;

  const marker = 'AION2-IL-WELCOME-HINT-v6';
  let existing;
  try {
    const msgs = await channel.messages.fetch({ limit: 50 });
    existing = msgs.find(m => m.author.id === client.user.id && m.content.includes(marker));
  } catch {}

  const payload = {
    content: `||${marker}||\n🤖 Need help? Check **#bot-commands** or use **/help**.`
  };

  if (existing) await existing.edit(payload);
  else {
    const msg = await channel.send(payload);
    try { await msg.pin(); } catch {}
  }
}

async function updateServerInfoPanel(client, guild) {
  const channel = ch(guild, cfg.channels.serverInfo);
  if (!channel?.isTextBased()) return;

  const state = await loadState();
  const marker = 'AION2-IL-SERVER-INFO-v6';
  let existing;
  try {
    const msgs = await channel.messages.fetch({ limit: 50 });
    existing = msgs.find(m => m.author.id === client.user.id && m.content.includes(marker));
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle('🌍 AION 2 Israel — Official Server Info')
    .setDescription(
`🌍 **Region:** ${state.region}
🌑 **Faction:** ${state.faction}
🖥️ **Server:** ${state.server}

⚠️ לפני יצירת הדמות הראשית, בדקו תמיד את הערוץ הזה כדי לוודא שאתם בוחרים את השרת הנכון.`
    )
    .setTimestamp();

  const payload = {
    content: `||${marker}||`,
    embeds: [embed]
  };

  if (existing) await existing.edit(payload);
  else {
    const msg = await channel.send(payload);
    try { await msg.pin(); } catch {}
  }
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function stripTags(s) {
  return decodeHtml(s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

async function fetchOfficialAionNews() {
  const url = 'https://about.ncsoft.com/en/news/all';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'AION2-Israel-Community-Bot/6.0',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });

  if (!res.ok) throw new Error(`NCSoft news fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  const results = [];
  const re = /<a[^>]+href=["']([^"']*\/en\/news\/article\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html)) !== null) {
    const href = m[1].startsWith('http') ? m[1] : `https://about.ncsoft.com${m[1]}`;
    const text = stripTags(m[2]);
    if (!/AION\s*2/i.test(text)) continue;
    const title = text.trim().slice(0, 240) || 'AION 2 News';
    if (!results.some(x => x.url === href)) results.push({ title, url: href });
  }

  return results.slice(0, 12);
}

async function checkAndPostNews(guild, force = false) {
  const target = ch(guild, cfg.channels.aionNews);
  if (!target?.isTextBased()) throw new Error('#aion-news not found');

  const state = await loadState();
  const items = await fetchOfficialAionNews();
  const unseen = items.filter(x => !state.seenNews.includes(x.url));
  const toPost = force ? (unseen.length ? unseen : items.slice(0, 1)) : unseen;

  for (const item of [...toPost].reverse()) {
    await target.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(item.title)
          .setURL(item.url)
          .setDescription('Official AION 2 news from NCSoft.')
          .setTimestamp()
      ]
    });
  }

  state.seenNews = [...new Set([...state.seenNews, ...items.map(x => x.url)])].slice(-200);
  state.lastNewsCheck = new Date().toISOString();
  await saveState(state);

  return { found: items.length, posted: toPost.length };
}

async function startNewsPolling(guild) {
  const run = async () => {
    try {
      const result = await checkAndPostNews(guild, false);
      console.log(`[news] found=${result.found} posted=${result.posted}`);
    } catch (err) {
      console.error('[news]', err.message);
    }
  };

  await run();
  newsTimer = setInterval(run, NEWS_MINUTES * 60_000);
}

function tagIdByName(forum, desired) {
  return forum.availableTags.find(t => t.name.toLowerCase() === desired.toLowerCase())?.id;
}

async function createBuildPost(interaction) {
  const forum = ch(interaction.guild, cfg.channels.builds);
  if (!forum || forum.type !== ChannelType.GuildForum) throw new Error('builds-and-classes forum not found');

  const title = interaction.options.getString('title');
  const type = interaction.options.getString('type');
  const tags = [];
  const id = tagIdByName(forum, type);
  if (id) tags.push(id);

  return forum.threads.create({
    name: title.slice(0, 100),
    appliedTags: tags,
    message: {
      embeds: [
        new EmbedBuilder()
          .setTitle(`📚 ${title}`)
          .addFields(
            { name: 'Author', value: `${interaction.user}`, inline: true },
            { name: 'Class', value: interaction.options.getString('class'), inline: true },
            { name: 'Type', value: type, inline: true },
            { name: 'Level / Progression', value: interaction.options.getString('level') || 'Not specified' },
            { name: 'Gear', value: interaction.options.getString('gear') || 'Not specified' },
            { name: 'Skills / Rotation', value: interaction.options.getString('skills') || 'Not specified' },
            { name: 'Notes', value: interaction.options.getString('notes') || '—' }
          )
          .setTimestamp()
      ]
    }
  });
}

async function createQuestionPost(interaction) {
  const forum = ch(interaction.guild, cfg.channels.questions);
  if (!forum || forum.type !== ChannelType.GuildForum) throw new Error('questions-help forum not found');

  const title = interaction.options.getString('title');
  const category = interaction.options.getString('category');
  const tags = [];
  const id = tagIdByName(forum, category);
  if (id) tags.push(id);

  return forum.threads.create({
    name: title.slice(0, 100),
    appliedTags: tags,
    message: {
      embeds: [
        new EmbedBuilder()
          .setTitle(`❓ ${title}`)
          .addFields(
            { name: 'Asked by', value: `${interaction.user}`, inline: true },
            { name: 'Category', value: category, inline: true },
            { name: 'Question', value: interaction.options.getString('details') }
          )
          .setTimestamp()
      ]
    }
  });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

client.once(Events.ClientReady, async ready => {
  try {
    const guild = await ready.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    await guild.roles.fetch();

    await registerCommands();
    await ensureBotCommandsPanel(client, guild);
    await ensureWelcomeHint(client, guild);
    await updateServerInfoPanel(client, guild);

    botTag = ready.user.tag;
    guildName = guild.name;
    clientReady = true;

    console.log(`[discord] online as ${botTag}`);
    console.log(`[discord] guild ${guildName}`);

    await startNewsPolling(guild);
  } catch (err) {
    console.error('[ready]', err);
    process.exit(1);
  }
});

client.on(Events.GuildMemberAdd, async member => {
  if (member.guild.id !== GUILD_ID) return;
  const welcome = ch(member.guild, cfg.channels.welcome);

  if (welcome?.isTextBased()) {
    try {
      await welcome.send({
        content: `${member}`,
        embeds: [
          new EmbedBuilder()
            .setTitle(`👋 ברוך הבא ${member.user.username}!`)
            .setDescription(`📜 קרא את **#rules**\n🌍 בדוק את **#server-info**\n🤖 בדוק את **#bot-commands**\n💬 תגיד שלום ב-**#general-עברית**\n\nנתראה באטרייה ⚔️`)
        ]
      });
    } catch {}
  }

  await sendLog(member.guild, '➕ Member Joined', `${member.user.tag} (${member.id}) joined.`);
});

client.on(Events.GuildMemberRemove, async member => {
  if (member.guild.id !== GUILD_ID) return;
  await sendLog(member.guild, '➖ Member Left', `${member.user?.tag ?? 'Unknown'} (${member.id}) left.`);
});

client.on(Events.MessageDelete, async message => {
  if (!message.guild || message.guild.id !== GUILD_ID || message.author?.bot) return;
  await sendLog(
    message.guild,
    '🗑️ Message Deleted',
    `**User:** ${message.author?.tag ?? 'Unknown'}\n**Channel:** <#${message.channelId}>\n**Message:** ${(message.content || '*No cached text*').slice(0,1500)}`
  );
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.guildId !== GUILD_ID || !interaction.isChatInputCommand()) return;
  console.log(`[interaction] /${interaction.commandName} from ${interaction.user.tag}`);

  try {
    if (interaction.commandName === 'ping') {
      return await interaction.reply({ content: '🏓 Pong — AION 2 Israel bot is online.', ephemeral: true });
    }

    if (interaction.commandName === 'help') {
      return await interaction.reply({
        ephemeral: true,
        embeds: [
          new EmbedBuilder()
            .setTitle('⚔️ AION 2 Israel Bot Help')
            .setDescription(
`/server — server information
/status — bot/community status
/rules — rules channel
/voice — voice channels
/lfg — Looking For Group
/build — create build forum post
/question — create help forum post
/news — refresh official AION 2 news
/event — staff event
/report — private staff report
/setserver — staff: update official server
/ping — bot status`
            )
        ]
      });
    }

    if (interaction.commandName === 'status') {
      const state = await loadState();
      const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
      const hours = Math.floor(uptimeSec / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);

      return await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('📊 AION 2 Israel Status')
            .addFields(
              { name: 'Bot', value: clientReady ? '🟢 Online' : '🟡 Starting', inline: true },
              { name: 'Uptime', value: `${hours}h ${minutes}m`, inline: true },
              { name: 'Members', value: `${interaction.guild.memberCount}`, inline: true },
              { name: 'Region', value: state.region, inline: true },
              { name: 'Faction', value: state.faction, inline: true },
              { name: 'Server', value: state.server, inline: true },
              { name: 'Last news sync', value: state.lastNewsCheck || 'Not yet', inline: false }
            )
            .setTimestamp()
        ]
      });
    }

    if (interaction.commandName === 'server') {
      const state = await loadState();
      return await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🌍 AION 2 Israel — Official Server Info')
            .setDescription(`🌍 **Region:** ${state.region}\n🌑 **Faction:** ${state.faction}\n🖥️ **Server:** ${state.server}`)
        ]
      });
    }

    if (interaction.commandName === 'setserver') {
      const allowed = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

      if (!allowed) {
        return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      }

      const state = await loadState();
      state.server = interaction.options.getString('server');
      state.faction = interaction.options.getString('faction') || state.faction;
      state.region = interaction.options.getString('region') || state.region;
      await saveState(state);
      await updateServerInfoPanel(client, interaction.guild);

      await sendLog(
        interaction.guild,
        '🖥️ Community Server Updated',
        `${interaction.user.tag} set server to **${state.server}**, faction **${state.faction}**, region **${state.region}**.`
      );

      return await interaction.reply({
        content: `✅ Updated community server to **${state.server}** (${state.region}, ${state.faction}).`,
        ephemeral: true
      });
    }

    if (interaction.commandName === 'rules') {
      const target = ch(interaction.guild, cfg.channels.rules);
      return await interaction.reply({ content: target ? `📜 <#${target.id}>` : 'Rules channel not found.', ephemeral: true });
    }

    if (interaction.commandName === 'voice') {
      const list = interaction.guild.channels.cache
        .filter(c => c.type === ChannelType.GuildVoice && c.name !== 'AFK')
        .map(c => `<#${c.id}>`).slice(0, 12).join('\n');

      return await interaction.reply({
        content: `🎧 **Voice channels**\n${list || 'None found.'}`,
        ephemeral: true
      });
    }

    if (interaction.commandName === 'news') {
      await interaction.deferReply({ ephemeral: true });
      const r = await checkAndPostNews(interaction.guild, true);
      return await interaction.editReply(`📰 News check complete. Found ${r.found}; posted ${r.posted}.`);
    }

    if (interaction.commandName === 'build') {
      await interaction.deferReply({ ephemeral: true });
      const thread = await createBuildPost(interaction);
      return await interaction.editReply(`✅ Build created: <#${thread.id}>`);
    }

    if (interaction.commandName === 'question') {
      await interaction.deferReply({ ephemeral: true });
      const thread = await createQuestionPost(interaction);
      return await interaction.editReply(`✅ Question created: <#${thread.id}>`);
    }

    if (interaction.commandName === 'lfg') {
      const target = ch(interaction.guild, cfg.channels.lfg);
      const embed = new EmbedBuilder().setTitle('🔎 Looking For Group').addFields(
        { name: 'Player', value: `${interaction.user}`, inline: true },
        { name: 'Activity', value: interaction.options.getString('activity'), inline: true },
        { name: 'Class / Role', value: interaction.options.getString('class'), inline: true },
        { name: 'Looking For', value: interaction.options.getString('need') },
        { name: 'Faction', value: interaction.options.getString('faction'), inline: true },
        { name: 'Voice', value: interaction.options.getString('voice') || 'Not specified', inline: true },
        { name: 'Time', value: interaction.options.getString('time') || 'Now', inline: true }
      ).setTimestamp();

      if (target?.isTextBased()) {
        await target.send({ embeds: [embed] });
        return await interaction.reply({ content: `✅ Posted in <#${target.id}>`, ephemeral: true });
      }

      return await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'event') {
      const allowed = interaction.memberPermissions?.has(PermissionFlagsBits.ManageEvents)
        || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

      if (!allowed) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });

      const target = ch(interaction.guild, cfg.channels.eventInfo);
      if (!target?.isTextBased()) return await interaction.reply({ content: 'event-info channel not found.', ephemeral: true });

      await target.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🎉 ${interaction.options.getString('title')}`)
            .addFields(
              { name: 'When', value: interaction.options.getString('when') },
              { name: 'Details', value: interaction.options.getString('details') },
              { name: 'Created by', value: `${interaction.user}` }
            )
            .setTimestamp()
        ]
      });

      return await interaction.reply({ content: `✅ Event posted in <#${target.id}>`, ephemeral: true });
    }

    if (interaction.commandName === 'report') {
      const modal = new ModalBuilder()
        .setCustomId('a2_report_modal')
        .setTitle('Report to AION 2 Israel Staff');

      const subject = new TextInputBuilder()
        .setCustomId('report_subject')
        .setLabel('Who / what are you reporting?')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120);

      const details = new TextInputBuilder()
        .setCustomId('report_details')
        .setLabel('What happened?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(subject),
        new ActionRowBuilder().addComponents(details)
      );

      return await interaction.showModal(modal);
    }
  } catch (err) {
    console.error(`[interaction:${interaction.commandName}]`, err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`❌ ${err.message}`).catch(()=>{});
    } else {
      await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true }).catch(()=>{});
    }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.guildId !== GUILD_ID || !interaction.isModalSubmit() || interaction.customId !== 'a2_report_modal') return;

  const target = ch(interaction.guild, cfg.channels.reports);
  if (target?.isTextBased()) {
    await target.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('🚨 New Community Report')
          .addFields(
            { name: 'Reporter', value: `${interaction.user} (${interaction.user.id})` },
            { name: 'Subject', value: interaction.fields.getTextInputValue('report_subject').slice(0,1024) },
            { name: 'Details', value: interaction.fields.getTextInputValue('report_details').slice(0,1024) }
          )
          .setTimestamp()
      ]
    });
  }

  await interaction.reply({ content: '✅ Your report was sent privately to staff.', ephemeral: true });
});

client.login(TOKEN).catch(err => {
  console.error('[login]', err);
  process.exit(1);
});
