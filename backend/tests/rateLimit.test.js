const test = require("node:test");
const assert = require("node:assert/strict");
const createRateLimiter = require("../src/middlewares/rateLimit.middleware");

const makeResponse = () => ({
  headers: {},
  statusCode: 200,
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("rate limiter permits requests up to the configured maximum", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
  const req = { ip: "192.0.2.10" };
  const first = makeResponse();
  const second = makeResponse();
  let nextCalls = 0;
  limiter(req, first, () => nextCalls++);
  limiter(req, second, () => nextCalls++);
  assert.equal(nextCalls, 2);
  assert.equal(second.headers["RateLimit-Remaining"], "0");
});

test("rate limiter rejects requests above the configured maximum", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
  const req = { ip: "192.0.2.11" };
  limiter(req, makeResponse(), () => {});
  const response = makeResponse();
  let nextCalled = false;
  limiter(req, response, () => { nextCalled = true; });
  assert.equal(response.statusCode, 429);
  assert.equal(response.body.success, false);
  assert.equal(nextCalled, false);
});
