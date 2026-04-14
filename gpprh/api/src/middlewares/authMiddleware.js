module.exports = (req, res, next) => {
    console.log("authMiddleware -> Cookies:", req.cookies);
    next();
};
