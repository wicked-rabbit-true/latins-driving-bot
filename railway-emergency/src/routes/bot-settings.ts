import { Router } from "express";
// @ts-ignore — pure JS module, no type declaration needed
import { BOT_SETTINGS_CONFIG } from "../whatsapp/bot-settings-config.js";

const router = Router();

router.get("/bot/settings", (_req, res) => {
  res.json({ settings: BOT_SETTINGS_CONFIG });
});

export default router;
