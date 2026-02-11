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
} = require("discord.js");

// ================== CONFIG ==================
const LOG_CHANNEL_ID = "1467202156053659680";

// Quem vê ticket ABERTO (+ usuário)
const OPEN_ROLE_IDS = [
"1466930240956928102",
"1466624764633284618",
"1466930699683500072",
"1466625590407987253",
"1466620017763422249",
];

// Quem pode usar /addcargo
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

// Só pode adicionar esses cargos no ticket
const ALLOWED_ADD_ROLE_IDS = [
"1466625339768967282",
"1466930438907105364",
];
// ===========================================

if (!process.env.TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
console.log("❌ Falta TOKEN/CLIENT_ID/GUILD_ID no .env");
process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Guarda configs dos painéis (em memória)
const panelConfigs = new Map(); // messageId -> { parentCategoryId, usarMenu, options }

// ========= HELPERS =========
function safeSlug(str) {
return (str || "")
.toLowerCase()
.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
.replace(/[^a-z0-9-]/g, "-")
.replace(/-+/g, "-")
.replace(/^-|-$/g, "");
}

function parseHexColor(input) {
if (!input) return 0x2b2d31;
let s = input.trim().toLowerCase();
if (s.startsWith("#")) s = s.slice(1);
if (!/^[0-9a-f]{6}$/.test(s)) return 0x2b2d31;
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

const arr = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);  
all.push(...arr);  

lastId = batch.last().id;  
if (batch.size < 100) break;

}

const lines = [];
lines.push("=== TRANSCRIPT TICKET ===");
lines.push(Servidor: ${channel.guild.name});
lines.push(Canal: #${channel.name} (${channel.id}));
lines.push(Gerado em: ${new Date().toLocaleString("pt-BR")});
lines.push(========================);
lines.push("");

for (const m of all) {
const time = new Date(m.createdTimestamp).toLocaleString("pt-BR");
let content = m.content || "";

if (m.attachments?.size) {  
  const urls = [...m.attachments.values()].map(a => a.url).join(" ");  
  content += `\n[anexos] ${urls}`;  
}  
lines.push(`[${time}] ${m.author.tag}: ${content}`);

}

return lines.join("\n");
}

async function createTicket({ guild, member, parentCategoryId, tipo }) {
const existing = guild.channels.cache.find(
c => c.type === ChannelType.GuildText &&
c.topic &&
c.topic.includes(ticket_user:${member.user.id})
);
if (existing) return { error: ⚠️ Você já tem um ticket aberto: <#${existing.id}> };

const ticketNum = Math.floor(Date.now() / 1000);
const openedAt = Date.now();

const overwrites = [
{ id: guild.roles.everyone.id, deny: ["ViewChannel"] },
{ id: member.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "AttachFiles"] },
...OPEN_ROLE_IDS.map(rid => ({
id: rid,
allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageMessages"],
})),
];

const nameBase = tipo
? ticket-${safeSlug(tipo)}-${ticketNum}
: ticket-${safeSlug(member.user.username)}-${ticketNum};

const ch = await guild.channels.create({
name: nameBase.slice(0, 90),
type: ChannelType.GuildText,
parent: parentCategoryId || undefined,
permissionOverwrites: overwrites,
topic: ticket_user:${member.user.id} | ticket_num:${ticketNum} | opened_at:${openedAt}${tipo ?  | tipo:${safeSlug(tipo)} : ""},
});

const embed = new EmbedBuilder()
.setTitle("🎫 Ticket aberto")
.setDescription(Ticket **${ticketNum}** criado.${tipo ? \nTipo: ${tipo} : ""}\nExplique seu problema aqui.)
.setColor(0x2b2d31);

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId("ticket_close")
.setLabel("Fechar Ticket")
.setStyle(ButtonStyle.Danger)
);

await ch.send({ content: <@${member.user.id}>, embeds: [embed], components: [row] });
return { channelId: ch.id, ticketNum };
}

// ========= SLASH COMMANDS =========

// ✅ Required primeiro, opcionais depois
const cmdPainel = new SlashCommandBuilder()
.setName("ticketpainel")
.setDescription("Cria um painel de ticket configurável (botão cinza, texto custom)")
.setDMPermission(false)

// obrigatórios
.addChannelOption(o =>
o.setName("canal_painel")
.setDescription("Canal onde o painel será enviado")
.setRequired(true)
)
.addStringOption(o =>
o.setName("titulo")
.setDescription("Título do embed")
.setRequired(true)
)
.addStringOption(o =>
o.setName("descricao")
.setDescription("Descrição (aceita ENTER ou \n)")
.setRequired(true)
)

// opcionais
.addChannelOption(o =>
o.setName("categoria_tickets")
.setDescription("Categoria onde os tickets serão criados (opcional)")
.setRequired(false)
)
.addStringOption(o =>
o.setName("imagem")
.setDescription("Imagem grande do embed (link direto)")
.setRequired(false)
)
.addStringOption(o =>
o.setName("thumbnail")
.setDescription("Thumbnail do embed (link direto)")
.setRequired(false)
)
.addStringOption(o =>
o.setName("cor")
.setDescription("Cor HEX da linha do embed (ex: #ff0000)")
.setRequired(false)
)
.addStringOption(o =>
o.setName("texto_botao")
.setDescription("Texto do botão (ex: 💯 Clique)")
.setRequired(false)
)
.addStringOption(o =>
o.setName("emoji_botao")
.setDescription("Emoji no botão (opcional)")
.setRequired(false)
)
.addBooleanOption(o =>
o.setName("usar_menu")
.setDescription("Se SIM: ao clicar, aparece menu. Se NÃO: abre direto.")
.setRequired(false)
)
.addStringOption(o =>
o.setName("opcoes_menu")
.setDescription("Opções do menu (1 por linha). Ex: Suporte|suporte|🛠")
.setRequired(false)
);

const cmdAddCargo = new SlashCommandBuilder()
.setName("addcargo")
.setDescription("Adiciona um cargo permitido para ver este ticket (somente staff autorizado)")
.setDMPermission(false)
.addRoleOption(o =>
o.setName("cargo")
.setDescription("Cargo permitido para adicionar neste ticket")
.setRequired(true)
);

const cmdEmbed = new SlashCommandBuilder()
.setName("embed")
.setDescription("Envia um embed normal (não é ticket)")
.setDMPermission(false)

// obrigatórios
.addChannelOption(o =>
o.setName("canal")
.setDescription("Canal onde o embed será enviado")
.setRequired(true)
)
.addStringOption(o =>
o.setName("titulo")
.setDescription("Título do embed")
.setRequired(true)
)
.addStringOption(o =>
o.setName("descricao")
.setDescription("Descrição (aceita ENTER ou \n)")
.setRequired(true)
)

// opcionais
.addStringOption(o =>
o.setName("cor")
.setDescription("Cor HEX da linha do embed (ex: #00ff99)")
.setRequired(false)
)
.addStringOption(o =>
o.setName("imagem")
.setDescription("Imagem grande (link direto)")
.setRequired(false)
)
.addStringOption(o =>
o.setName("thumbnail")
.setDescription("Thumbnail (link direto)")
.setRequired(false)
)
.addStringOption(o =>
o.setName("footer")
.setDescription("Texto do footer (opcional)")
.setRequired(false)
)
.addStringOption(o =>
o.setName("footer_icon")
.setDescription("Ícone do footer (link direto)")
.setRequired(false)
);

async function registerCommands() {
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
await rest.put(
Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
{ body: [cmdPainel.toJSON(), cmdAddCargo.toJSON(), cmdEmbed.toJSON()] }
);
console.log("✅ Comandos registrados: /ticketpainel, /addcargo, /embed");
}

// ========= EVENTS =========
client.once(Events.ClientReady, async () => {
console.log(✅ Bot online: ${client.user.tag});
try {
await registerCommands();
} catch (e) {
console.log("❌ RegisterCommands:", e?.message || e);
}
});

client.on(Events.InteractionCreate, async (interaction) => {
try {
// ================= /embed =================
if (interaction.isChatInputCommand() && interaction.commandName === "embed") {
// se quiser só dono usar:
if (interaction.user.id !== interaction.guild.ownerId) {
return interaction.reply({ content: "❌ Só o dono do servidor pode usar /embed.", flags: MessageFlags.Ephemeral });
}

const canal = interaction.options.getChannel("canal", true);  
  if (!canal?.isTextBased()) {  
    return interaction.reply({ content: "❌ O canal precisa ser de texto.", flags: MessageFlags.Ephemeral });  
  }  

  const titulo = interaction.options.getString("titulo", true);  
  let descricao = interaction.options.getString("descricao", true).replaceAll("\\n", "\n");  

  const cor = parseHexColor(interaction.options.getString("cor") || "");  
  const imagem = interaction.options.getString("imagem") || null;  
  const thumbnail = interaction.options.getString("thumbnail") || null;  
  const footer = interaction.options.getString("footer") || null;  
  const footerIcon = interaction.options.getString("footer_icon") || null;  

  const embed = new EmbedBuilder()  
    .setTitle(titulo)  
    .setDescription(descricao)  
    .setColor(cor);  

  if (thumbnail) embed.setThumbnail(thumbnail);  
  if (imagem) embed.setImage(imagem);  

  if (footer && footerIcon) embed.setFooter({ text: footer, iconURL: footerIcon });  
  else if (footer) embed.setFooter({ text: footer });  

  await canal.send({ embeds: [embed] });  

  return interaction.reply({ content: `✅ Embed enviado em <#${canal.id}>`, flags: MessageFlags.Ephemeral });  
}  

// ================= /ticketpainel =================  
if (interaction.isChatInputCommand() && interaction.commandName === "ticketpainel") {  
  // só dono  
  if (interaction.user.id !== interaction.guild.ownerId) {  
    return interaction.reply({ content: "❌ Só o dono do servidor pode usar esse comando.", flags: MessageFlags.Ephemeral });  
  }  

  const canalPainel = interaction.options.getChannel("canal_painel", true);  
  if (!canalPainel?.isTextBased()) {  
    return interaction.reply({ content: "❌ canal_painel precisa ser um canal de texto.", flags: MessageFlags.Ephemeral });  
  }  

  const titulo = interaction.options.getString("titulo", true);  
  let descricao = interaction.options.getString("descricao", true).replaceAll("\\n", "\n");  

  const categoriaTickets = interaction.options.getChannel("categoria_tickets", false);  
  if (categoriaTickets && categoriaTickets.type !== ChannelType.GuildCategory) {  
    return interaction.reply({ content: "❌ categoria_tickets precisa ser uma CATEGORIA.", flags: MessageFlags.Ephemeral });  
  }  

  const imagem = interaction.options.getString("imagem") || null;  
  const thumbnail = interaction.options.getString("thumbnail") || null;  
  const cor = parseHexColor(interaction.options.getString("cor") || "");  
  const textoBotao = (interaction.options.getString("texto_botao") || "Abrir Ticket").slice(0, 80);  
  const emojiBotao = interaction.options.getString("emoji_botao") || null;  

  const usarMenu = interaction.options.getBoolean("usar_menu") ?? false;  
  const opcoesMenuRaw = (interaction.options.getString("opcoes_menu") || "").replaceAll("\\n", "\n");  

  const embed = new EmbedBuilder()  
    .setTitle(titulo)  
    .setDescription(descricao)  
    .setColor(cor);  

  if (thumbnail) embed.setThumbnail(thumbnail);  
  if (imagem) embed.setImage(imagem);  

  // ✅ botão cinza (travado como você pediu)  
  const btn = new ButtonBuilder()  
    .setCustomId("ticket_open")  
    .setLabel(textoBotao)  
    .setStyle(ButtonStyle.Secondary);  

  if (emojiBotao) btn.setEmoji(emojiBotao);  

  const row = new ActionRowBuilder().addComponents(btn);  

  const sent = await canalPainel.send({ embeds: [embed], components: [row] });  

  // menu options: "Label|valor|emoji"  
  const options = [];  
  if (usarMenu && opcoesMenuRaw.trim()) {  
    const lines = opcoesMenuRaw.split("\n").map(s => s.trim()).filter(Boolean);  
    for (const line of lines.slice(0, 25)) {  
      const [label, value, emoji] = line.split("|").map(s => (s || "").trim());  
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
    content:  
      `✅ Painel enviado em <#${canalPainel.id}>.\n` +  
      `📌 Tickets vão para: ${categoriaTickets ? `categoria <#${categoriaTickets.id}>` : "SEM categoria (raiz)"}.`,  
    flags: MessageFlags.Ephemeral  
  });  
}  

// ================= /addcargo =================  
if (interaction.isChatInputCommand() && interaction.commandName === "addcargo") {  
  const channel = interaction.channel;  
  const member = interaction.member;  

  if (!channel?.topic?.includes("ticket_user:")) {  
    return interaction.reply({ content: "❌ Use este comando DENTRO de um ticket.", flags: MessageFlags.Ephemeral });  
  }  

  const canUse = CAN_ADD_ROLE_IDS.some(rid => member.roles.cache.has(rid));  
  if (!canUse) {  
    return interaction.reply({ content: "❌ Você não pode adicionar cargos neste ticket.", flags: MessageFlags.Ephemeral });  
  }  

  const role = interaction.options.getRole("cargo", true);  
  if (!ALLOWED_ADD_ROLE_IDS.includes(role.id)) {  
    return interaction.reply({ content: "❌ Você só pode adicionar os 2 cargos permitidos.", flags: MessageFlags.Ephemeral });  
  }  

  const existing = channel.permissionOverwrites.cache.get(role.id);  
  if (existing?.allow?.has("ViewChannel")) {  
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

  // se tiver menu configurado, mostra  
  if (cfg?.usarMenu) {  
    const menu = new StringSelectMenuBuilder()  
      .setCustomId(`ticket_menu:${panelMessageId}`)  
      .setPlaceholder("Escolha o tipo do ticket")  
      .addOptions(cfg.options);  

    const row = new ActionRowBuilder().addComponents(menu);  

    return interaction.reply({  
      content: "Selecione uma opção:",  
      components: [row],  
      flags: MessageFlags.Ephemeral  
    });  
  }  

  // sem menu -> abre direto  
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

  // anti-clique duplo  
  if (channel.name.startsWith("fechando-")) {  
    return interaction.reply({ content: "⚠️ Já está fechando...", flags: MessageFlags.Ephemeral });  
  }  
  try { await channel.setName(`fechando-${channel.name}`.slice(0, 90)); } catch {}  

  await interaction.reply({ content: "⏳ Fechando e gerando log .txt...", flags: MessageFlags.Ephemeral });  

  const info = parseTopic(channel.topic);  
  const ticketNum = info.ticketNum || channel.id;  
  const openedAt = info.openedAt ? new Date(info.openedAt) : null;  

  const transcript = await buildTranscript(channel);  
  const fileName = `ticket-${ticketNum}.txt`;  
  const tmpPath = path.join(os.tmpdir(), fileName);  
  fs.writeFileSync(tmpPath, transcript, "utf-8");  
  const attachment = new AttachmentBuilder(tmpPath, { name: fileName });  

  const logEmbed = new EmbedBuilder()  
    .setTitle("📁 Ticket fechado")  
    .setColor(0x2b2d31)  
    .addFields(  
      { name: "Ticket", value: `${ticketNum}`, inline: true },  
      { name: "Tipo", value: info.tipo ? info.tipo : "—", inline: true },  
      { name: "Canal", value: `#${channel.name}`, inline: false },  
      { name: "Aberto por", value: info.userId ? `<@${info.userId}>` : "desconhecido", inline: false },  
      { name: "Fechado por", value: `<@${interaction.user.id}>`, inline: false },  
      { name: "Aberto em", value: openedAt ? openedAt.toLocaleString("pt-BR") : "?", inline: false },
