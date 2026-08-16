export function requireFwSubscriptionActive(req, res, next) {
  if (!req.user) {
    if (req.originalUrl.startsWith("/api/")) {
      return res.status(401).json({ error: "Unauthorized access. Please log in." });
    }
    return res.redirect("/login");
  }

  const fw = req.user.fwSubscription;
  const active =
    fw &&
    fw.status === "active" &&
    fw.endDate &&
    new Date(fw.endDate).getTime() > Date.now();

  if (active) return next();

  if (req.originalUrl.startsWith("/api/")) {
    return res.status(403).json({ error: "Forwarding Bot subscription required" });
  }

  return res.redirect("/subscriptions");
}

