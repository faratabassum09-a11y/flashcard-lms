module.exports = (req, res, next) => {

  // NOT LOGGED IN
  if(!req.isAuthenticated || !req.isAuthenticated()){
    
    req.flash(
      "error",
      "Please login first"
    );

    return res.redirect("/");
  }

  // NOT ADMIN
  if(req.user.username !== "admin"){

    req.flash(
      "error",
      "Access denied"
    );

    return res.redirect("/dashboard");
  }

  // ALLOW
  next();

};