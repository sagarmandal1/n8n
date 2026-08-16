import { Router } from "express";
import { login, logout, me, register } from "../controllers/authController.js";
import { authenticate } from "../middlewares/authMiddleware.js";

const authRouter = Router();

authRouter.post("/login", login);

authRouter.post("/register", register);

authRouter.get('/profile', authenticate, me);
authRouter.get('/me', authenticate, me); // alias for frontend compatibility

authRouter.get("/logout", authenticate, logout);

export default authRouter;
