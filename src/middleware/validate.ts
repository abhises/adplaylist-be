import type { NextFunction, Request, Response } from "express";
import type { ObjectSchema } from "joi";

function validate(schema: ObjectSchema, source: "body" | "params" | "query") {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return res.status(400).json({
        error: error.details.map((d) => d.message).join(", "),
      });
    }
    req[source] = value;
    next();
  };
}

export function validateBody(schema: ObjectSchema) {
  return validate(schema, "body");
}

export function validateParams(schema: ObjectSchema) {
  return validate(schema, "params");
}
