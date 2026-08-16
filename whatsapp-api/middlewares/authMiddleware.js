import jwt from "jsonwebtoken";
import User from "../models/userModel.js";

export async function authenticate(req, res, next) {
  const handleUnauthorized = () => {
    if (req.originalUrl.startsWith("/api/")) {
      return res.status(401).json({ error: "Unauthorized access. Please log in." });
    }
    req.user = null;
    return next();
  };

  try {
    const token = req.cookies?.token;

    if (!token) {
      return handleUnauthorized();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });

    if (!decoded || !decoded.userId) {
      return handleUnauthorized();
    }

    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return handleUnauthorized();
    }

    req.user = user;
    next();
  } catch (err) {
    return handleUnauthorized();
  }
}

export function isAdmin(req, res, next) {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Admin privileges required." });
  }
}
