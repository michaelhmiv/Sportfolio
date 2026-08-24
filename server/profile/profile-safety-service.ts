import type { PrivateProfileSentinel, PublicProfileResponse } from "@shared/trophy-case";
import { isProfileBlockedForViewer } from "./profile-safety";
import type { PublicProfileService } from "./profile-service";

function blockedProfileError(): Error & { statusCode?: number } {
  const error = new Error("User not found") as Error & { statusCode?: number };
  error.statusCode = 404;
  return error;
}

/**
 * Decorates the public-profile service with viewer-specific block enforcement.
 * Keeping this outside the HTTP route preserves route test isolation while
 * ensuring every production public-profile lookup uses the same safety gate.
 */
export class ProfileSafetyPublicProfileService implements PublicProfileService {
  constructor(private readonly delegate: PublicProfileService) {}

  async getPublicProfile(
    requestedUserId: string,
    viewerUserId: string | null,
  ): Promise<PublicProfileResponse | PrivateProfileSentinel> {
    if (await isProfileBlockedForViewer(viewerUserId, requestedUserId)) {
      throw blockedProfileError();
    }

    return this.delegate.getPublicProfile(requestedUserId, viewerUserId);
  }
}
