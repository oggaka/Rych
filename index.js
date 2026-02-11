// ================== IMPORTS ==================
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  AttachmentBuilder,
  StringSelectMenuBuilder,
  Events,
  MessageFlags,
  PermissionsBitField,
} = require("discord.js");

// ================== CONFIG ==================
const LOG_CHANNEL_ID = "1467202156053659680";

const OPEN_ROLE_IDS = [
  "1466930240956928102",
  "1466624764633284618",
  "1466930699683500072",
  "1466625590407987253",
  "1466620017763422249",
];

const CAN_ADD_ROLE_IDS = [
  "1466930240956928102",
  "1466624764633284618",
  "1466930699683500072",
  "1466625590407987253",
  "1466620017763422249",
  "1466624566733312237",
  "1466879476284784701",
  "1467215227090243700",
];

const ALLOWED_ADD_ROLE_IDS = [
  "1466625339768967282",
  "1466930438907105364",
];

// ============================================

if (!process.env.TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
  console.log("❌ Falta TOKEN / CLIENT_ID / GUILD_ID no .env");
  process.exit(1);
}

// ================== CLIENT ==================
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const panelConfigs = new Map();

// ================== HELPERS ==================

function safeSlug(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseHexColor(input) {
  if (!input) return 0x2b2d31;
  let s = input.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(s)) return 0x2b2d31;
  return parseInt(s, 16);
}

function parseTopic(topic) {
  const out = {};

  if (!topic) return out;

  const u = topic.match(/ticket_user:(\d+)/);
  const n = topic.match(/ticket_num:(\d+)/);

  if (u) out.userId = u[1];
  if (n) out.ticketNum = n[1];

  return out;
}

async function buildTranscript(channel) {
  let lastId = null;
  const all = [];

  while (true) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    });

    if (!batch.size) break;

    const arr = [...batch.values()].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    all.push(...arr);

    lastId = batch.last().id;

    if (batch.size < 100) break;
  }

  const lines = [];

  lines.push("===== TRANSCRIPT =====");
  lines.push(`Servidor: ${channel.guild.name}`);
  lines.push(`Canal: #${channel.name}`);
  lines.push("");

  for (const m of all) {
    const time = new Date(m.createdTimestamp).toLocaleString("pt-BR");

    let content = m.content || "";

    if (m.attachments?.size) {
      const urls = [...m.attachments.values()]
        .map((a) => a.url)
        .join(" ");

      content += ` [Anexos] ${urls}`;
    }

    lines.push(`[${time}] ${m.author.tag}: ${content}`);
  }

  return lines.join("\n");
}

async function createTicket({ guild, member, parentCategoryId, tipo }) {
  const existing = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildText &&
      c.topic?.includes(`ticket_user:${member.id}`)
  );

  if (existing) {
    return { error: `⚠️ Você já tem ticket: <#${existing.id}>` };
  }

  const ticketNum = Date.now();

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },

    {
      id: member.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },

    ...OPEN_ROLE_IDS.map((r) => ({
      id: r,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    })),
  ];

  const name = tipo
    ? `ticket-${safeSlug(tipo)}-${ticketNum}`
    : `ticket-${safeSlug(member.user.username)}-${ticketNum}`;

  const channel = await guild.channels.create({
    name: name.slice(0, 90),
    type: ChannelType.GuildText,
    parent: parentCategoryId || null,
    permissionOverwrites: overwrites,
    topic: `ticket_user:${member.id} | ticket_num:${ticketNum}`,
  });

  const embed = new EmbedBuilder()
    .setTitle("🎫 Ticket Aberto")
    .setDescription("Explique seu problema.")
    .setColor(0x2b2d31);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Fechar Ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@${member.id}>`,
    embeds: [embed],
    components: [row],
  });

  return { channelId: channel.id };
}

// ================== SLASH ==================

const cmdPainel = new SlashCommandBuilder()
  .setName("ticketpainel")
  .setDescription("Criar painel de ticket")
  .setDMPermission(false)

  .addChannelOption((o) =>
    o.setName("canal").setDescription("Canal").setRequired(true)
  )

  .addStringOption((o) =>
    o.setName("titulo").setDescription("Título").setRequired(true)
  )

  .addStringOption((o) =>
    o.setName("descricao").setDescription("Descrição").setRequired(true)
  )

  .addChannelOption((o) =>
    o.setName("categoria").setDescription("Categoria").setRequired(false)
  )

  .addBooleanOption((o) =>
    o.setName("menu").setDescription("Usar menu").setRequired(false)
  )

  .addStringOption((o) =>
    o.setName("opcoes").setDescription("Opções menu").setRequired(false)
  );

const cmdAdd = new SlashCommandBuilder()
  .setName("addcargo")
  .setDescription("Adicionar cargo no ticket")
  .setDMPermission(false)

  .addRoleOption((o) =>
    o.setName("cargo").setDescription("Cargo").setRequired(true)
  );

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),

    {
      body: [cmdPainel.toJSON(), cmdAdd.toJSON()],
    }
  );

  console.log("✅ Comandos registrados");
}

// ================== READY ==================

client.once(Events.ClientReady, async () => {
  console.log(`✅ Online: ${client.user.tag}`);

  await registerCommands();
});

// ================== INTERACTIONS ==================

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ===== Painel =====
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "ticketpainel"
    ) {
      if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({
          content: "❌ Só dono pode usar.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const canal = interaction.options.getChannel("canal");
      const titulo = interaction.options.getString("titulo");
      const descricao = interaction.options
        .getString("descricao")
        .replaceAll("\\n", "\n");

      const categoria = interaction.options.getChannel("categoria");

      const embed = new EmbedBuilder()
        .setTitle(titulo)
        .setDescription(descricao)
        .setColor(0x2b2d31);

      const btn = new ButtonBuilder()
        .setCustomId("ticket_open")
        .setLabel("Abrir Ticket")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(btn);

      const msg = await canal.send({
        embeds: [embed],
        components: [row],
      });

      panelConfigs.set(msg.id, {
        parentCategoryId: categoria?.id || null,
      });

      return interaction.reply({
        content: "✅ Painel criado",
        flags: MessageFlags.Ephemeral,
      });
    }

    // ===== Botão abrir =====
    if (interaction.isButton() && interaction.customId === "ticket_open") {
      const cfg = panelConfigs.get(interaction.message.id);

      const res = await createTicket({
        guild: interaction.guild,
        member: interaction.member,
        parentCategoryId: cfg?.parentCategoryId,
      });

      if (res.error) {
        return interaction.reply({
          content: res.error,
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        content: `✅ Ticket: <#${res.channelId}>`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ===== Fechar =====
    if (interaction.isButton() && interaction.customId === "ticket_close") {
      const channel = interaction.channel;

      if (!channel.topic?.includes("ticket_user:")) {
        return interaction.reply({
          content: "❌ Não é ticket",
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.reply({
        content: "⏳ Fechando...",
        flags: MessageFlags.Ephemeral,
      });

      const info = parseTopic(channel.topic);

      const transcript = await buildTranscript(channel);

      const filePath = path.join(
        os.tmpdir(),
        `ticket-${info.ticketNum}.txt`
      );

      fs.writeFileSync(filePath, transcript);

      const file = new AttachmentBuilder(filePath);

      const log = await interaction.guild.channels.fetch(LOG_CHANNEL_ID);

      if (log?.isTextBased()) {
        await log.send({
          content: `📁 Ticket fechado`,
          files: [file],
        });
      }

      fs.unlinkSync(filePath);

      setTimeout(() => channel.delete(), 2000);
    }
  } catch (err) {
    console.log(err);
  }
});

// ================== LOGIN ==================
client.login(process.env.TOKEN);
