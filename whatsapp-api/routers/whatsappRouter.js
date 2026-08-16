import { Router } from "express";
import {
  deleteMessage,
  getGroups,
  giveReaction,
  sendAudio,
  sendFile,
  sendLocation,
  sendPhoto,
  sendPoll,
  sendText,
  sendVideo,
} from "../controllers/whatsappController.js";
import upload from "../lib/multer.js";

const whatsappRouter = Router();
//  /api/whatsapp
whatsappRouter.post("/send/text", sendText);
whatsappRouter.post("/send/location", sendLocation);
whatsappRouter.post("/send/photo", upload.array("photos", 10), sendPhoto);
whatsappRouter.post("/send/video", upload.array("videos", 5), sendVideo);
whatsappRouter.post("/send/audio", upload.array("audios", 5), sendAudio);
whatsappRouter.post("/send/file", upload.array("files", 5), sendFile);
whatsappRouter.post("/send/poll", sendPoll);
whatsappRouter.post("/message/react", giveReaction);
whatsappRouter.post("/message/delete", deleteMessage);
whatsappRouter.get("/get/groups", getGroups);

export default whatsappRouter;
