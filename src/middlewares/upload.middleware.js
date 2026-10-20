// middlewares/upload.js
const multer = require("multer");
const { withUploadLimit } = require("../utils/file/upload-limit");

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

const storage = multer.memoryStorage();

const upload = withUploadLimit(multer({
  storage,
  limits: {
    fileSize: MAX_FILE_BYTES,
  },
}), MAX_FILE_BYTES);

module.exports = upload;
