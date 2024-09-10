import {NextFunction, Request, Response} from "express";
import {HttpStatusCodes} from "@common/http-status-codes.js";

export class BaseHttpController {
  async sendWelcomeMessage(req: Request, res: Response, next: NextFunction) {
    return res.status(HttpStatusCodes.OK).send({
      message: "Welcome to the Localful server. For docs see https://github.com/ben-ryder/localful."
    })
  }
}
