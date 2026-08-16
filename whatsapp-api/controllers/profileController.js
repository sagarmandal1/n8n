import User from "../models/userModel.js";

export async function profileUpdate(req, res) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    const { name, username, email } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      {
        name,
        username,
        email,
      },
      { new: true },
    );

    return res
      .status(200)
      .json({ message: "Profile updated successfully", user: updatedUser });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function changePassword(req, res) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { currentPassword, newPassword } = req.body;
    const updateUser = await User.findById(user._id).select("+password");

    const isPasswordMatch = await updateUser.matchPassword(currentPassword);
    if (!isPasswordMatch) {
      return res.status(400).json({ error: "Invalid current password" });
    }

    updateUser.password = newPassword;
    await updateUser.save();

    return res
      .status(200)
      .json({ message: "Password changed successfully", user });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: error.message });
  }
}
