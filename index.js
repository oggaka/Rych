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

/* ================== BRAND / CONFIG ================== */
const BRAND = Object.freeze({
  NAME: "Rych",
  NAME_LOWER: "rych",
});

const CONFIG = Object.freeze({
  LOG_CHANNEL_ID: "1470962979397701683",
  DEFAULT_COLOR: 0x2b2d31,

  OPEN_ROLE_IDS: [
    "1466930240956928102",
    "1466624764633284618",
    "1466930699683500072",
    "1466625590407987253",
    "1466620017763422249",
  ],

  CAN_ADD_ROLE_IDS: [
    "1466930240956928102",
    "1466624764633284618",
    "1466930699683500072",
    "1466625590407987253",
    "1466620017763422249",
    "1466624566733312237",
    "1466879476284784701",
    "1467215227090243700",
  ],

  ALLOWED_ADD_ROLE_IDS: ["1466625339768967282", "1466930438907105364"],
});
/* ============================================ */

function mustEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    console.log(`❌ Falta ${name} nas variáveis de ambiente.`);
    process.exit(1);
  }
  return String(v).trim();
}
mustEnv("TOKEN");
mustEnv("CLIENT_ID");
mustEnv("GUILD_ID");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// messageId -> { parentCategoryId, usarMenu, options }
const panelConfigs = new Map();

/* ================== HELPERS ================== */
function trimOrNull(s) {
  const t = (s ?? "").toString().trim();
  return t ? t : null;
}

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
  if (!input) return CONFIG.DEFAULT_COLOR;
  let s = input.trim().toLowerCase();
  if (s.startsWith("#")) s = s.slice(1);
  if (!/^[0-9a-f]{6}$/.test(s)) return CONFIG.DEFAULT_COLOR;
  return parseInt(s, 16);
}

function parseTopic(topic) {
  const out = { userId: null, ticketNum: null, openedAt: null, tipo: null };
  if (!topic) return out;

  const mU = topic.match(/ticket_user:(\d+)/);
  if (mU) out.userId = mU[1];

  const mN = topic.match(/ticket_num:(\d+)/);
  if (mN) out.ticketNum = mN[1];

  const mT = topic.match(/opened_at:(\d+)/);
  if (mT) out.openedAt = Number(mT[1]);

  const mTipo = topic.match(/tipo:([a-z0-9_-]+)/);
  if (mTipo) out.tipo = mTipo[1];

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
  lines.push("=== TRANSCRIPT TICKET ===");
  lines.push(`Marca: ${BRAND.NAME}`);
  lines.push(`Servidor: ${channel.guild.name}`);
  lines.push(`Canal: #${channel.name} (${channel.id})`);
  lines.push(`Gerado em: ${new Date().toLocaleString("pt-BR")}`);
  lines.push("========================");
  lines.push("");

  for (const m of all) {
    const time = new Date(m.createdTimestamp).toLocaleString("pt-BR");
    let content = m.content || "";

    if (m.attachments?.size) {
      const urls = [...m.attachments.values()].map((a) => a.url).join(" ");
      content += `\n[anexos] ${urls}`;
    }

    lines.push(`[${time}] ${m.author.tag}: ${content}`);
  }

  return lines.join("\n");
}
/* ============================================ */

async function createTicket({ guild, member, parentCategoryId, tipo }) {
  const existing = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildText &&
      c.topic &&
      c.topic.includes(`ticket_user:${member.user.id}`)
  );
  if (existing) return { error: `⚠️ Você já tem um ticket aberto: <#${existing.id}>` };

  const ticketNum = Math.floor(Date.now() / 1000);
  const openedAt = Date.now();

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    {
      id: member.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
      ],
    },
    ...CONFIG.OPEN_ROLE_IDS.map((rid) => ({
      id: rid,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages,
      ],
    })),
  ];

  const nameBase = tipo
    ? `ticket-${safeSlug(tipo)}-${ticketNum}`
    : `ticket-${safeSlug(member.user.username)}-${ticketNum}`;

  const ch = await guild.channels.create({
    name: nameBase.slice(0, 90),
    type: ChannelType.GuildText,
    parent: parentCategoryId || undefined,
    permissionOverwrites: overwrites,
    topic: `ticket_user:${member.user.id} | ticket_num:${ticketNum} | opened_at:${openedAt}${tipo ? ` | tipo:${safeSlug(tipo)}` : ""}`,
  });

  const embed = new EmbedBuilder()
    .setTitle("🎫 Ticket aberto")
    .setDescription(`Ticket **${ticketNum}** criado.${tipo ? `\nTipo: **${tipo}**` : ""}\nExplique seu problema aqui.`)
    .setColor(CONFIG.DEFAULT_COLOR)
    .setFooter({ text: BRAND.NAME });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_close").setLabel("Fechar Ticket").setStyle(ButtonStyle.Danger)
  );

  await ch.send({ content: `<@${member.user.id}>`, embeds: [embed], components: [row] });
  return { channelId: ch.id, ticketNum };
}

/* ================== SLASH COMMANDS ================== */

const cmdPainel = new SlashCommandBuilder()
  .setName("ticketpainel")
  .setDescription("Cria painel de ticket (envio em canal opcional)")
  .setDMPermission(false)
  // obrigatórios
  .addStringOption((o) => o.setName("titulo").setDescription("Título do embed").setRequired(true))
  .addStringOption((o) => o.setName("descricao").setDescription("Descrição (ENTER ou \\n)").setRequired(true))
  .addStringOption((o) => o.setName("texto_botao").setDescription("Texto do botão (obrigatório)").setRequired(true))
  .addStringOption((o) => o.setName("emoji_botao").setDescription("Emoji do botão (obrigatório)").setRequired(true))
  // opcionais (canal destino vem primeiro nos opcionais)
  .addChannelOption((o) =>
    o.setName("canal_destino").setDescription("Canal onde o painel será enviado (opcional)").setRequired(false)
  )
  .addChannelOption((o) =>
    o.setName("categoria_tickets").setDescription("Categoria onde os tickets serão criados (opcional)").setRequired(false)
  )
  .addStringOption((o) => o.setName("imagem").setDescription("Imagem grande (link direto)").setRequired(false))
  .addStringOption((o) => o.setName("thumbnail").setDescription("Thumbnail (link direto)").setRequired(false))
  .addStringOption((o) => o.setName("cor").setDescription("Cor HEX (ex: #ff0000)").setRequired(false))
  .addBooleanOption((o) => o.setName("usar_menu").setDescription("Se SIM: ao clicar aparece menu").setRequired(false))
  .addStringOption((o) => o.setName("opcoes_menu").setDescription("1 por linha: Label|valor|emoji").setRequired(false));

const cmdAddCargo = new SlashCommandBuilder()
  .setName("addcargo")
  .setDescription("Adiciona cargo permitido para ver este ticket")
  .setDMPermission(false)
  .addRoleOption((o) => o.setName("cargo").setDescription("Cargo permitido").setRequired(true));

const cmdEmbed = new SlashCommandBuilder()
  .setName("embed")
  .setDescription("Envia um embed normal (envio em canal opcional)")
  .setDMPermission(false)
  // obrigatórios
  .addStringOption((o) => o.setName("titulo").setDescription("Título").setRequired(true))
  .addStringOption((o) => o.setName("descricao").setDescription("Descrição (ENTER ou \\n)").setRequired(true))
  // opcionais (canal destino primeiro nos opcionais)
  .addChannelOption((o) =>
    o.setName("canal_destino").setDescription("Canal onde enviar (opcional)").setRequired(false)
  )
  .addStringOption((o) => o.setName("cor").setDescription("Cor HEX").setRequired(false))
  .addStringOption((o) => o.setName("imagem").setDescription("Imagem (link direto)").setRequired(false))
  .addStringOption((o) => o.setName("thumbnail").setDescription("Thumbnail (link direto)").setRequired(false))
  .addStringOption((o) => o.setName("footer").setDescription("Footer (opcional)").setRequired(false))
  .addStringOption((o) => o.setName("footer_icon").setDescription("Footer icon (link)").setRequired(false));

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: [cmdPainel.toJSON(), cmdAddCargo.toJSON(), cmdEmbed.toJSON()] }
  );
  console.log("✅ Comandos registrados: /ticketpainel /addcargo /embed");
}

/* ================== EVENTS ================== */

client.once(Events.ClientReady, async () => {
  console.log(`✅ ${BRAND.NAME} bot online: ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (e) {
    console.log("❌ registerCommands:", e?.message || e);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ================= /embed =================
    if (interaction.isChatInputCommand() && interaction.commandName === "embed") {
      if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({
          content: "❌ Só o dono do servidor pode usar /embed.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const canalDestino = interaction.options.getChannel("canal_destino", false) ?? interaction.channel;
      if (!canalDestino?.isTextBased()) {
        return interaction.reply({ content: "❌ Canal destino precisa ser de texto.", flags: MessageFlags.Ephemeral });
      }

      const titulo = trimOrNull(interaction.options.getString("titulo", true));
      const descricaoRaw = interaction.options.getString("descricao", true).replaceAll("\\n", "\n");
      const descricao = trimOrNull(descricaoRaw);

      if (!titulo || !descricao) {
        return interaction.reply({ content: "❌ Título/descrição não podem ficar vazios.", flags: MessageFlags.Ephemeral });
      }

      const cor = parseHexColor(interaction.options.getString("cor") || "");
      const imagem = trimOrNull(interaction.options.getString("imagem"));
      const thumbnail = trimOrNull(interaction.options.getString("thumbnail"));
      const footer = trimOrNull(interaction.options.getString("footer"));
      const footerIcon = trimOrNull(interaction.options.getString("footer_icon"));

      const embed = new EmbedBuilder().setTitle(titulo).setDescription(descricao).setColor(cor);
      if (thumbnail) embed.setThumbnail(thumbnail);
      if (imagem) embed.setImage(imagem);
      if (footer && footerIcon) embed.setFooter({ text: footer, iconURL: footerIcon });
      else if (footer) embed.setFooter({ text: footer });
      else embed.setFooter({ text: BRAND.NAME });

      await canalDestino.send({ embeds: [embed] });

      return interaction.reply({
        content: `✅ Embed enviado em <#${canalDestino.id}>`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ================= /ticketpainel =================
    if (interaction.isChatInputCommand() && interaction.commandName === "ticketpainel") {
      if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({
          content: "❌ Só o dono do servidor pode usar esse comando.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const titulo = trimOrNull(interaction.options.getString("titulo", true));
      const descricaoRaw = interaction.options.getString("descricao", true).replaceAll("\\n", "\n");
      const descricao = trimOrNull(descricaoRaw);

      const textoBotao = trimOrNull(interaction.options.getString("texto_botao", true));
      const emojiBotao = trimOrNull(interaction.options.getString("emoji_botao", true));

      if (!titulo || !descricao) {
        return interaction.reply({ content: "❌ Título/descrição não podem ficar vazios.", flags: MessageFlags.Ephemeral });
      }
      if (!textoBotao) {
        return interaction.reply({ content: "❌ texto_botao não pode ficar vazio.", flags: MessageFlags.Ephemeral });
      }
      if (!emojiBotao) {
        return interaction.reply({ content: "❌ emoji_botao não pode ficar vazio.", flags: MessageFlags.Ephemeral });
      }

      const canalDestino = interaction.options.getChannel("canal_destino", false) ?? interaction.channel;
      if (!canalDestino?.isTextBased()) {
        return interaction.reply({ content: "❌ Canal destino precisa ser de texto.", flags: MessageFlags.Ephemeral });
      }

      const categoriaTickets = interaction.options.getChannel("categoria_tickets", false);
      if (categoriaTickets && categoriaTickets.type !== ChannelType.GuildCategory) {
        return interaction.reply({ content: "❌ categoria_tickets precisa ser uma CATEGORIA.", flags: MessageFlags.Ephemeral });
      }

      const imagem = trimOrNull(interaction.options.getString("imagem"));
      const thumbnail = trimOrNull(interaction.options.getString("thumbnail"));
      const cor = parseHexColor(interaction.options.getString("cor") || "");

      const usarMenu = interaction.options.getBoolean("usar_menu") ?? false;
      const opcoesMenuRaw = (interaction.options.getString("opcoes_menu") || "").replaceAll("\\n", "\n");

      const embed = new EmbedBuilder()
        .setTitle(titulo)
        .setDescription(descricao)
        .setColor(cor)
        .setFooter({ text: BRAND.NAME });

      if (thumbnail) embed.setThumbnail(thumbnail);
      if (imagem) embed.setImage(imagem);

      const btn = new ButtonBuilder()
        .setCustomId("ticket_open")
        .setLabel(textoBotao.slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emojiBotao);

      const row = new ActionRowBuilder().addComponents(btn);
      const sent = await canalDestino.send({ embeds: [embed], components: [row] });

      const options = [];
      if (usarMenu && trimOrNull(opcoesMenuRaw)) {
        const lines = opcoesMenuRaw.split("\n").map((s) => s.trim()).filter(Boolean);
        for (const line of lines.slice(0, 25)) {
          const [label, value, emoji] = line.split("|").map((s) => (s || "").trim());
          if (!label || !value) continue;
          const opt = { label: label.slice(0, 100), value: value.slice(0, 100) };
          if (emoji) opt.emoji = emoji;
          options.push(opt);
        }
      }

      panelConfigs.set(sent.id, {
        parentCategoryId: categoriaTickets?.id || null,
        usarMenu: Boolean(usarMenu && options.length),
        options,
      });

      return interaction.reply({
        content: `✅ Painel enviado em <#${canalDestino.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ================= /addcargo =================
    if (interaction.isChatInputCommand() && interaction.commandName === "addcargo") {
      const channel = interaction.channel;
      const member = interaction.member;

      if (!channel?.topic?.includes("ticket_user:")) {
        return interaction.reply({ content: "❌ Use este comando DENTRO de um ticket.", flags: MessageFlags.Ephemeral });
      }

      const canUse = CONFIG.CAN_ADD_ROLE_IDS.some((rid) => member.roles.cache.has(rid));
      if (!canUse) {
        return interaction.reply({ content: "❌ Você não pode adicionar cargos neste ticket.", flags: MessageFlags.Ephemeral });
      }

      const role = interaction.options.getRole("cargo", true);
      if (!CONFIG.ALLOWED_ADD_ROLE_IDS.includes(role.id)) {
        return interaction.reply({ content: "❌ Você só pode adicionar os 2 cargos permitidos.", flags: MessageFlags.Ephemeral });
      }

      const existing = channel.permissionOverwrites.cache.get(role.id);
      if (existing?.allow?.has(PermissionsBitField.Flags.ViewChannel)) {
        return interaction.reply({ content: `⚠️ O cargo <@&${role.id}> já tem acesso a este ticket.`, flags: MessageFlags.Ephemeral });
      }

      await channel.permissionOverwrites.edit(role.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });

      await interaction.reply({ content: `✅ Cargo <@&${role.id}> adicionado neste ticket.`, flags: MessageFlags.Ephemeral });
      await channel.send(`🔓 Cargo adicionado: <@&${role.id}> (por <@${interaction.user.id}>)`);
      return;
    }

    // ================= Botão Abrir Ticket =================
    if (interaction.isButton() && interaction.customId === "ticket_open") {
      const guild = interaction.guild;
      const member = interaction.member;

      const panelMessageId = interaction.message?.id;
      const cfg = panelMessageId ? panelConfigs.get(panelMessageId) : null;

      if (cfg?.usarMenu) {
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`ticket_menu:${panelMessageId}`)
          .setPlaceholder("Escolha o tipo do ticket")
          .addOptions(cfg.options);

        const row = new ActionRowBuilder().addComponents(menu);

        return interaction.reply({
          content: "Selecione uma opção:",
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
      }

      const res = await createTicket({
        guild,
        member,
        parentCategoryId: cfg?.parentCategoryId || null,
        tipo: null,
      });

      if (res.error) return interaction.reply({ content: res.error, flags: MessageFlags.Ephemeral });
      return interaction.reply({ content: `✅ Ticket criado: <#${res.channelId}>`, flags: MessageFlags.Ephemeral });
    }

    // ================= Menu (tipo do ticket) =================
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("ticket_menu:")) {
      const panelMessageId = interaction.customId.split(":")[1];
      const cfg = panelConfigs.get(panelMessageId);

      if (!cfg?.usarMenu) {
        return interaction.reply({ content: "❌ Este painel não tem menu configurado.", flags: MessageFlags.Ephemeral });
      }

      const tipo = interaction.values?.[0] || null;

      const res = await createTicket({
        guild: interaction.guild,
        member: interaction.member,
        parentCategoryId: cfg.parentCategoryId,
        tipo,
      });

      if (res.error) return interaction.reply({ content: res.error, flags: MessageFlags.Ephemeral });
      return interaction.reply({ content: `✅ Ticket criado: <#${res.channelId}>`, flags: MessageFlags.Ephemeral });
    }

    // ================= Fechar Ticket (LOG + DELETAR) =================
    if (interaction.isButton() && interaction.customId === "ticket_close") {
      const channel = interaction.channel;
      const guild = interaction.guild;

      if (!channel?.topic?.includes("ticket_user:")) {
        return interaction.reply({ content: "❌ Isso não parece um ticket.", flags: MessageFlags.Ephemeral });
      }

      if (channel.name.startsWith("fechando-")) {
        return interaction.reply({ content: "⚠️ Já está fechando...", flags: MessageFlags.Ephemeral });
      }

      try { await channel.setName(`fechando-${channel.name}`.slice(0, 90)); } catch {}

      await interaction.reply({ content: "⏳ Fechando e gerando log .txt...", flags: MessageFlags.Ephemeral });

      const info = parseTopic(channel.topic);
      const ticketNum = info.ticketNum 
