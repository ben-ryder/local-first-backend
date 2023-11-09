import {Injectable} from "@nestjs/common";

import {sign, verify} from "jsonwebtoken";
import {ConfigService} from "../config/config";
import {
  AccessTokenPayload,
  RefreshTokenPayload,
  Roles,
  TokenPair,
  UserDto
} from "@ben-ryder/lfb-common";
import {DataStoreService} from "../data-store/data-store.service";
import {v4 as createUUID} from "uuid";
import {SystemError} from "../errors/base/system.error";
import ms, { StringValue } from "ms";


@Injectable()
export class TokenService {
  constructor(
    private configService: ConfigService,
    private dataStoreService: DataStoreService,
  ) {}

  /**
   * Take an expiry string such as "15 mins" and convert it to an epoch timestamp.
   *
   * @param expiryString
   * @private
   */
  private getTokenExpiry(expiryString: StringValue) {
    const currentTime = new Date().getTime();
    const timeToExpiry = ms(expiryString);
    return currentTime + timeToExpiry;
  }

  /**
   * Create a new token pair for the given user.
   *
   * @param userDto
   */
  async createNewTokenPair(userDto: UserDto): Promise<TokenPair> {
    const groupId = createUUID();
    const counterId = 1;

    // Generate the expiry of the refresh token here so I can set an initial expiry on the sid value stored.
    // This expiry is then updated as the token is refreshed.
    // todo: the expiry of the stored sid doesn't exactly match the refresh tokens expiry as set by jsonwebtoken.
    const expiry = this.getTokenExpiry(this.configService.config.auth.refreshToken.expiry as StringValue);

    await this.setTokenGroupCounterId(groupId, counterId, expiry);
    return this.createTokenPair(userDto, groupId, counterId);
  }

  /**
   * Create a new token pair for the given user's token group.
   *
   * @param userDto
   * @param groupId
   */
  async getRefreshedTokenPair(userDto: UserDto, groupId: string): Promise<TokenPair> {
    const counterId = await this.getTokenGroupCounterId(groupId);
    if (!counterId) {
      throw new SystemError({
        message: `Failed to find cid for token group '${groupId}' for user '${userDto.id}.'`
      });
    }

    // Update the expiry of the sequence id to match the newly generated refresh token.
    // todo: the expiry of the stored sid doesn't exactly match the refresh tokens expiry as set by jsonwebtoken.
    const expiry = this.getTokenExpiry(this.configService.config.auth.refreshToken.expiry as StringValue);
    await this.setTokenGroupCounterId(groupId, counterId + 1, expiry);

    return this.createTokenPair(userDto, groupId, counterId + 1);
  }

  /**
   * Return a token pair for the given user, group and counter ID.
   *
   * @param userDto
   * @param groupId
   * @param counterId
   * @private
   */
  private async createTokenPair(userDto: UserDto, groupId: string, counterId: number): Promise<TokenPair> {
    const basicPayload = {
      iss: this.configService.config.auth.issuer || "local-first-backend",
      aud: this.configService.config.auth.audience || "local-first-backend",
      sub: userDto.id,
      gid: groupId,
      cid: counterId,
    };

    const accessTokenPayload = {
      ...basicPayload,
      type: "accessToken",
      isVerified: userDto.isVerified,
      roles: [Roles.USER]
    };
    const accessToken = sign(
      accessTokenPayload,
      this.configService.config.auth.accessToken.secret,
      { expiresIn: this.configService.config.auth.accessToken.expiry },
    );

    const refreshTokenPayload = {
      ...basicPayload,
      type: "refreshToken"
    };
    const refreshToken = sign(
      refreshTokenPayload,
      this.configService.config.auth.refreshToken.secret,
      { expiresIn: this.configService.config.auth.refreshToken.expiry },
    );

    return {
      accessToken,
      refreshToken
    };
  }

  /**
   * Validate the given access token. Return its payload if valid or null if not.
   * @param accessToken
   */
  async validateAndDecodeAccessToken(accessToken: string): Promise<AccessTokenPayload|null> {
    try {
      const payload = verify(accessToken, this.configService.config.auth.accessToken.secret) as unknown as AccessTokenPayload;
      const isValidToken = await this.validateCustomAuthClaims(payload.gid, payload.cid);
      if (isValidToken) {
        return payload;
      }
    }
    catch (err) {
      // verify will throw an error if it fails
    }

    return null;
  }

  /**
   * Validate the given refresh token. Return its payload if valid or null if not.
   * @param refreshToken
   */
  async validateAndDecodeRefreshToken(refreshToken: string): Promise<RefreshTokenPayload|null> {
    try {
      const payload = verify(refreshToken, this.configService.config.auth.refreshToken.secret) as unknown as RefreshTokenPayload;
      const isValidToken = await this.validateCustomAuthClaims(payload.gid, payload.cid);
      if (isValidToken) {
        return payload;
      }
    }
    catch (err) {
      // verify will throw an error if it fails
    }

    return null;
  }

  /**
   * Validate the custom auth claims of the token.
   * These are the gid and cid values.
   *
   * @param groupId
   * @param counterId
   */
  async validateCustomAuthClaims(groupId: string, counterId: number) {
    const isBlacklisted = await this.isTokenGroupBlacklisted(groupId);
    if (isBlacklisted) {
      return false;
    }

    const storedCounterId = await this.getTokenGroupCounterId(groupId);
    return counterId === storedCounterId;
  }

  /**
   * Blacklist the given token group.
   *
   * @param groupId
   * @param expiry
   */
  async blacklistTokenGroup(groupId: string, expiry: number) {
    await this.dataStoreService.addItem(`bl-${groupId}`, "true", {
      epochExpiry: expiry
    });
  }

  /**
   * Determine if the given groupId has been blacklisted.
   *
   * @param groupId
   * @private
   */
  private async isTokenGroupBlacklisted(groupId: string): Promise<boolean> {
    return await this.dataStoreService.getItem(`bl-${groupId}`) !== null;
  }

  /**
   * Set the counter ID for the given token group.
   *
   * @param groupId
   * @param counterId
   * @param expiry
   * @private
   */
  private async setTokenGroupCounterId(groupId: string, counterId: number, expiry: number): Promise<void> {
    await this.dataStoreService.addItem(`cid-${groupId}`, counterId.toString(), {epochExpiry: expiry});
  }

  /**
   * Fetch the counter ID for the supplied toke group.
   * Will return null if the counter ID doesn't exist or is invalid.
   *
   * @param groupId
   * @private
   */
  private async getTokenGroupCounterId(groupId: string): Promise<number|null> {
    const counterIdIdString = await this.dataStoreService.getItem(`cid-${groupId}`);
    if (!counterIdIdString) {
      return null;
    }

    try {
      return parseInt(counterIdIdString);
    }
    catch (e) {
      // todo: should do special handling if the data is invalid?
      return null;
    }
  }
}
