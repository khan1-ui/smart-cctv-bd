
const axios = require("axios");

// API Configuration
const API_URL =
  "http://localhost:5000/api/devices/SCBD-02874EA86DCE6A29/share";

// Keep your Owner JWT in the environment variable.
// Never hardcode or share your real token.
const OWNER_TOKEN = process.argv[2];

const MEMBER_EMAIL = "concurrency@example.com";
const TOTAL_REQUESTS = 5;

const runConcurrencyTest = async () => {
  if (!OWNER_TOKEN) {
    console.error("❌ OWNER_TOKEN environment variable is missing.");
    process.exit(1);
  }

  console.log("Starting Concurrent Invitation Test...");
  console.log(`Total Requests: ${TOTAL_REQUESTS}`);
  console.log(`Target Member: ${MEMBER_EMAIL}`);
  console.log("----------------------------------");

  const requests = Array.from(
    { length: TOTAL_REQUESTS },
    (_, index) => {
      return axios
        .post(
          API_URL,
          { email: MEMBER_EMAIL },
          {
            headers: {
              Authorization: `Bearer ${OWNER_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        )
        .then((response) => ({
          request: index + 1,
          status: response.status,
          success: response.data.success,
          message: response.data.message,
        }))
        .catch((error) => ({
          request: index + 1,
          status: error.response?.status || "NETWORK ERROR",
          success: false,
          message:
            error.response?.data?.message || error.message,
        }));
    }
  );

  const results = await Promise.all(requests);

  console.table(results);

  const successful = results.filter(
    (result) => result.status === 201
  ).length;

  const conflicts = results.filter(
    (result) => result.status === 409
  ).length;

  console.log("----------------------------------");
  console.log(`Successful Requests: ${successful}`);
  console.log(`Conflict Requests: ${conflicts}`);
  console.log("Concurrency Test Completed.");
};

runConcurrencyTest();
