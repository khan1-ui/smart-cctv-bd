
const axios = require("axios");

const API_URL =
  "http://localhost:5000/api/devices/share";

const MEMBER_TOKEN = process.argv[2];
const INVITATION_ID = process.argv[3];

const runTest = async () => {
  if (!MEMBER_TOKEN || !INVITATION_ID) {
    console.error(
      "Usage: node src/scripts/accept-concurrency-test.js <MEMBER_TOKEN> <INVITATION_ID>"
    );
    process.exit(1);
  }

  const url = `${API_URL}/${INVITATION_ID}/accept`;

  console.log("Starting Concurrent Accept Test...");
  console.log("Sending 2 requests simultaneously...");

  const requests = [1, 2].map((number) =>
    axios
      .post(
        url,
        {},
        {
          headers: {
            Authorization: `Bearer ${MEMBER_TOKEN}`,
          },
        }
      )
      .then((response) => ({
        request: number,
        status: response.status,
        message: response.data.message,
      }))
      .catch((error) => ({
        request: number,
        status: error.response?.status || "NETWORK ERROR",
        message:
          error.response?.data?.message || error.message,
      }))
  );

  const results = await Promise.all(requests);

  console.table(results);
  console.log("Concurrent Accept Test Completed.");
};

runTest();
