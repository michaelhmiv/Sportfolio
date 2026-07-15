import { publicIdentityRepository } from "./public-identity-repository";
import { PostgresPublicIdentityService } from "./public-identity-service";

export const publicIdentityService = new PostgresPublicIdentityService(
  publicIdentityRepository,
);
