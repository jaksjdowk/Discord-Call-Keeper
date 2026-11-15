
import { Client, GatewayIntentBits, ActivityType, Events } from "discord.js";
import { getVoiceConnection, VoiceConnectionStatus } from "@discordjs/voice";
import { loadConfig } from "./config";
import { VoiceCallKeeper } from "./voice";
import { startHttpServer } from "./server";

async function main() {
  console.log("\n=======================================================");
  console.log("  🚀 Starting Discord Call Keeper (24/7 Voice Sustainer)");
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

  const voiceKeeper = new VoiceCallKeeper(client, config.guildId, config.channelId);
  const server = startHttpServer(config.port, client, voiceKeeper);

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[Bot] Logged in as ${readyClient.user.tag}!`);

    readyClient.user.setPresence({
      activities: [
        {
          name: "Sustaining Call 24/7 🟢",
          type: ActivityType.Custom,
        },
      ],
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

  client.on(Events.ShardError, (error, shardId) => {
    console.error(`[Shard ${shardId}] Gateway error:`, error);
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
