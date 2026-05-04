import { Router, type IRouter } from "express";
import healthRouter from "./health";
import qrRouter from "./qr";
import { studentsRouter } from "./students";
import questionsRouter from "./questions";
import notificationsRouter from "./notifications";
import languageCacheRouter from "./language-cache";
import googleContactsRouter from "./google-contacts";
import certificatesRouter from "./certificates";
import { botActionsRouter } from "./bot-actions";
import pendientesRouter from "./pendientes";
import prospectsRouter from "./prospects";
import botSettingsRouter from "./bot-settings";
import examRouter from "./exam";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(qrRouter);
router.use("/students", studentsRouter);
router.use("/students", botActionsRouter);
router.use(questionsRouter);
router.use(notificationsRouter);
router.use(languageCacheRouter);
router.use("/google-contacts", googleContactsRouter);
router.use("/certificates", certificatesRouter);
router.use(pendientesRouter);
router.use(prospectsRouter);
router.use(botSettingsRouter);
router.use(examRouter);
router.use(storageRouter);

export default router;
