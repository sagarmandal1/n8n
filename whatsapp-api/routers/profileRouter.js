import { Router } from "express";
import { changePassword, profileUpdate } from "../controllers/profileController.js";




const profileRouter = Router();

profileRouter.put("/update", profileUpdate);
profileRouter.post("/update/password", changePassword);



export default profileRouter;