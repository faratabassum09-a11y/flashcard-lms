require("dotenv").config();
const express        = require("express");
const mongoose       = require("mongoose");
const path           = require("path");
const ejsMate        = require("ejs-mate");
const session        = require("express-session");
const MongoStore     = require("connect-mongo").default;
const flash          = require("connect-flash");
const passport       = require("passport");
const LocalStrategy  = require("passport-local");
const methodOverride = require("method-override");
const cron           = require("node-cron");

const User         = require("./models/user");
const Test         = require("./models/test");
const ExpressError = require("./utils/ExpressError");

const authRoutes      = require("./routes/authRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const flashcardRoutes = require("./routes/flashcardRoutes");
const testRoutes      = require("./routes/testRoutes");
const adminRoutes     = require("./routes/adminRoutes");
const userRoutes      = require("./routes/userRoutes");

const app = express();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB connected");
    try {
      await mongoose.connection.db.collection("results").dropIndex("rollNo_1_testId_1");
    } catch (e) {
      console.log("Old index not found (already clean):", e.codeName || e.message);
    }
  })
  .catch((err) => console.log("MongoDB error:", err));

app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("layout", "layouts/boilerplate");

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(methodOverride("_method"));
app.use(express.json());

const store = MongoStore.create({
  mongoUrl: process.env.MONGO_URI,
  crypto: { secret: process.env.SESSION_SECRET },
  touchAfter: 24 * 3600
});
store.on("error", (err) => console.log("Session store error", err));

app.use(session({
  store,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    maxAge:  1000 * 60 * 60 * 24 * 7,
    httpOnly: true
  }
}));

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());
app.use(flash());

app.use((req, res, next) => {
  res.locals.success  = req.flash("success");
  res.locals.error    = req.flash("error");
  res.locals.currUser = req.user;
  next();
});

cron.schedule("* * * * *", async () => {
  const now = new Date();
  await Test.updateMany(
    { scheduledStart: { $lte: now }, isActive: false, isEnded: false },
    { isActive: true, startTime: now }
  );
  await Test.updateMany(
    { scheduledEnd: { $lte: now }, isActive: true, isEnded: false },
    { isActive: false, isEnded: true }
  );
  const active = await Test.find({ isActive: true, isEnded: false });
  for (const t of active) {
    if (!t.startTime) continue;
    const elapsed = (now - new Date(t.startTime)) / 60000;
    if (elapsed >= t.duration) {
      await Test.findByIdAndUpdate(t._id, { isActive: false, isEnded: true });
    }
  }
});

app.get("/", (req, res) => res.redirect("/login"));

app.use("/", authRoutes);
app.use("/", dashboardRoutes);
app.use("/", flashcardRoutes);
app.use("/", testRoutes);
app.use("/", adminRoutes);
app.use("/", userRoutes);

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use((req, res, next) => next(new ExpressError(404, "Page not found")));
app.use((err, req, res, next) => {
  const { statusCode = 500 } = err;
  res.status(statusCode).render("error.ejs", { err });
});

app.listen(5000, "0.0.0.0", () => console.log("Server running on port 5000"));