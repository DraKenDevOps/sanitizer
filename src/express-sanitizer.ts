import { Request, Response, NextFunction } from "express";
import sanitizer from "./sanitizer";

export interface SanitizableRequest extends Request {
  sanitize?: (param: string) => string | undefined;
  [key: string]: unknown;
}

export type ExpressSanitizer = (req: SanitizableRequest, res: Response, next: NextFunction) => void;

export default function expressSanitizer(): ExpressSanitizer {
  return function (req: SanitizableRequest, _res: Response, next: NextFunction): void {
    req.sanitize = function (param: string): string | undefined {
      if (param) return sanitizer.sanitize(param);
      return undefined;
    };
    next();
  };
}

export { expressSanitizer };
