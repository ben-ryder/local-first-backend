import {TestHelper} from "../../../../tests/e2e/test-helper";
import {sign} from "jsonwebtoken";
import {ConfigService} from "../../../services/config/config";
import {testUsers} from "../../../../tests/test-data/test-data";
import {expectUnauthorized} from "../../../../tests/e2e/common-expects/expect-unauthorized";


describe("Check Auth",() => {
  const testHelper = new TestHelper();

  beforeAll(async () => {
    await testHelper.beforeAll()
  })
  afterAll(async () => {
    await testHelper.afterAll()
  });
  beforeEach(async () => {
    await testHelper.beforeEach()
  });

  test("When authenticated, the request should succeed", async () => {
    const accessToken = await testHelper.getUserAccessToken(testUsers[0]);

    const {statusCode} = await testHelper.client
      .get("/v1/auth/check")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(statusCode).toEqual(200);
  })

  test("When not authenticated, the request should fail", async () => {
    const {body, statusCode} = await testHelper.client
      .get("/v1/auth/check")

    expectUnauthorized(body, statusCode);
  })

  test("When supplying an incorrectly signed accessToken, the request should fail", async () => {
    const accessToken = sign(
      {userId: testUsers[0].id, type: "accessToken"},
      "qethwrthwrthr",
      {expiresIn: "1hr"}
    );

    const {body, statusCode} = await testHelper.client
      .get("/v1/auth/check")
      .set("Authorization", `Bearer ${accessToken}`)

    expectUnauthorized(body, statusCode);
  })

  test("When supplying an invalid accessToken, the request should fail", async () => {
    const {body, statusCode} = await testHelper.client
      .get("/v1/auth/check")
      .set("Authorization", "Bearer SWFubawgrlkx")

    expectUnauthorized(body, statusCode);
  })

  test("When supplying an expired accessToken, the request should fail", async () => {
    const configService = testHelper.app.get(ConfigService);

    const accessToken = sign(
      {userId: testUsers[0].id, type: "accessToken"},
      configService.config.auth.accessToken.secret,
      {expiresIn: 0}
    );

    const {body, statusCode} = await testHelper.client
      .get("/v1/auth/check")
      .set("Authorization", `Bearer ${accessToken}`)

    expectUnauthorized(body, statusCode);
  })
})
