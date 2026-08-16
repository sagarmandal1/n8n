
import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";

export async function subscriptionMiddleware(req, res, next) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(400).json({ error: "x-api-key header required" });
    }

     const session = await Session.findOne({ apiKey });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }


    const user = await User.findById(session.user).select("-password");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.subscription) {
      return res.status(403).json({ error: "Subscription not found" });
    }

    if (user.subscription.status !== "active") {
      return res.status(403).json({ error: `Subscription is ${user.subscription.status}` });
    }
    // Make the authenticated tenant context available to downstream API
    // controllers. This prevents callers from selecting another user's
    // session or customer data through request parameters.
    req.session = session;
    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
