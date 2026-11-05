const crypto = require("crypto");

/**
 * Generate a unique camera device identifier.
 */
const generateDeviceId = () => {
  const uniqueId = crypto.randomBytes(8).toString("hex");

  return `SCBD-${uniqueId.toUpperCase()}`;
};

module.exports = generateDeviceId;