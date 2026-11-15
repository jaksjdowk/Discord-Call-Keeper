import { Client, GatewayIntentBits, ActivityType, Events } from "discord.js";
import { getVoiceConnection, VoiceConnectionStatus } from "@discordjs/voice";
import { loadConfig } from "./config";
import { VoiceCallKeeper } from "./voice";
import { startHttpServer } from "./server";

async function main() {
  console.log("\n=======================================================");
  console.log("  Starting Discord Call Keeper");
  console.log("=======================================================\n");

  const config = loadConfig();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const geminiHistory = new Map<string, any[]>();

  // Sistema de inteligencia artificial
  client.on(Events.MessageCreate, async (message) => {
    console.log(
      "[CHAT TEST] Mensaje recibido. Canal:",
      message.channelId,
      "| Canal configurado:",
      process.env.TEXT_CHANNEL_ID
    );

    if (message.author.bot) return;
    if (message.guildId !== config.guildId) return;
    if (!message.mentions.users.has(client.user!.id)) return;
    const botId = client.user?.id;

    if (!botId || !message.mentions.users.has(botId)) return;

    console.log("[CHAT] Mención detectada. Procesando...");

    const prompt = message.content
      .replace(new RegExp(`<@!?${botId}>`, "g"), "")
      .trim();

    if (!prompt) {
      await message.reply("¡Dime algo! 😎");
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error("[Gemini] Falta GEMINI_API_KEY.");
      await message.reply("No tengo configurada mi inteligencia artificial.");
      return;
    }

    try {
      await message.channel.sendTyping();

      const history = geminiHistory.get(message.author.id) || [];

      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{
                text: "Eres Call Keeper, un bot de Discord amigable, divertido y natural. Habla español, conversa como un compañero de servidor y utiliza humor cuando encaje. No finjas ser una persona real."
              }]
            },
            contents: [
              ...history,
              { role: "user", parts: [{ text: prompt }] }
            ],
            generationConfig: {
              maxOutputTokens: 500
            }
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Gemini] Error:", response.status, errorText);

        await message.reply(
          "Tengo un problema conectándome con Gemini. Inténtalo otra vez."
        );
        return;
      }

      const data: any = await response.json();

      const answer = data.candidates?.[0]?.content?.parts
        ?.map((part: any) => part.text || "")
        .join("")
        .trim();

      if (!answer) {
        console.error("[Gemini] Respuesta vacía:", JSON.stringify(data));
        await message.reply("No pude generar una respuesta esta vez.");
        return;
      }

      history.push(
        { role: "user", parts: [{ text: prompt }] },
        { role: "model", parts: [{ text: answer }] }
      );

      geminiHistory.set(message.author.id, history.slice(-10));

      await message.reply({
        content: answer.slice(0, 1900),
        allowedMentions: { repliedUser: false }
      });

      console.log("[Gemini] Respuesta enviada correctamente.");

    } catch (error) {
      console.error("[Gemini] Error:", error);
      await message.reply("Se me complicó responder. Inténtalo otra vez.");
    }
  });

  const voiceKeeper = new VoiceCallKeeper(
    client,
    config.guildId,
    config.channelId
  );

  const server = startHttpServer(config.port, client, voiceKeeper);

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[Bot] Logged in as ${readyClient.user.tag}!`);

    readyClient.user.setPresence({
      activities: [{
        name: "Sustaining Call 24/7",
        type: ActivityType.Custom,
      }],
      status: "online",
    });

    await voiceKeeper.start();
  });

  client.on(Events.Error, (err) => {
    console.error("[Bot Error]", err);
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (newState.id !== client.user?.id) return;

    if (!newState.channelId) {
      if (oldState.channelId && !voiceKeeper.isConnectingState) {
        console.warn("[Voice State] Bot disconnected. Reconnecting...");
        voiceKeeper.connect(true);
      }
      return;
    }

    if (newState.channelId !== config.channelId) {
      console.warn("[Voice State] Bot moved. Rejoining target channel...");
      voiceKeeper.connect(true);
    }
  });

  client.on(Events.ShardDisconnect, (event, shardId) => {
    console.warn(`[Shard ${shardId}] Disconnected (code: ${event.code})`);
  });

  client.on(Events.ShardReconnecting, (shardId) => {
    console.log(`[Shard ${shardId}] Reconnecting...`);
  });

  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    console.log(`[Shard ${shardId}] Resumed. Checking voice connection...`);

    const existingConn = getVoiceConnection(config.guildId);

    if (!existingConn || existingConn.state.status !== VoiceConnectionStatus.Ready) {
      voiceKeeper.connect(true);
    }
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[Anti-Crash] Unhandled rejection:", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[Anti-Crash] Uncaught exception:", error);
  });

  const shutdown = () => {
    console.log("\n[App] Shutting down...");
    voiceKeeper.stop();
    server.close();
    client.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[Bot] Logging in to Discord...");

  try {
    await client.login(config.token);
  } catch (error: any) {
    console.error("FAILED TO LOG IN:", error?.message || error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled fatal error:", err);
  process.exit(1);
});
