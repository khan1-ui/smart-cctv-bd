const axios = require("axios");

const DEVICE_ID = "SCBD-02874EA86DCE6A29";
const API_BASE_URL = "http://localhost:5000/api/devices";

const OWNER_TOKEN = process.argv[2];
const INVITATION_ID = process.argv[3];

const runTest = async () => {
  if (!OWNER_TOKEN || !INVITATION_ID) {
    console.error(
      "Usage: node src/scripts/cancel-concurrency-test.js <OWNER_TOKEN> <INVITATION_ID>"
    );
    process.exit(1);
  }

  const url = `${API_BASE_URL}/${DEVICE_ID}/invitations/${INVITATION_ID}`;

  console.log("Starting Concurrent Cancel Test...");
  console.log("Sending 2 requests simultaneously...");

  const requests = [1, 2].map((number) =>
    axios
      .delete(url, {
        headers: {
          Authorization: `Bearer ${OWNER_TOKEN}`,
        },
      })
      .then((response) => ({
        request: number,
        status: response.status,
        message: response.data.message,
      }))
      .catch((error) => ({
        request: number,
        status: error.response?.status || "NETWORK ERROR",
        message: error.response?.data?.message || error.message,
      }))
  );

  const results = await Promise.all(requests);

  console.table(results);
  console.log("Concurrent Cancel Test Completed.");
};

runTest();