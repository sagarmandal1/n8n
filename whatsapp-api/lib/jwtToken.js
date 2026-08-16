import jwt from "jsonwebtoken";
export function generateToken(userId) {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });
  return token;
}
