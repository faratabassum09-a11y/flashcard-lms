const mongoose = require("mongoose");
const User = require("../models/user");

mongoose.connect("mongodb://127.0.0.1:27017/flashcardLearn");

async function seedAdmin() {
  try {
    const exists = await User.findOne({ username: "admin" });

    if (exists) {
      console.log("Admin already exists");
      return mongoose.connection.close();
    }

    await User.register(
      new User({ username: "admin", role: "admin" }),
      "Admin@12345"
    );

    console.log("Admin created");
    mongoose.connection.close();

  } catch (err) {
    console.log(err);
    mongoose.connection.close();
  }
}

seedAdmin();