const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '../.env')
});
const mongoose = require("mongoose");
const User = require("../models/user");

mongoose.connect(process.env.MONGO_URI)

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