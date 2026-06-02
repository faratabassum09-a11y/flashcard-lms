const mongoose = require("mongoose");
const passportLocalMongoose = require("passport-local-mongoose").default;
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  uploadBatch: String,
 
  
});
userSchema.plugin(passportLocalMongoose);
module.exports = mongoose.model("User", userSchema);