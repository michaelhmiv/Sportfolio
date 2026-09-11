import {
  PostgresPublicProfileService,
  PostgresPublicTrophyService,
  PostgresTrophyCaseEditorService,
} from "./profile-service";
import { ProfileSafetyPublicProfileService } from "./profile-safety-service";

export const publicTrophyService = new PostgresPublicTrophyService();
const baseProfileService = new PostgresPublicProfileService(publicTrophyService);
export const profileService = new ProfileSafetyPublicProfileService(baseProfileService);
export const editorService = new PostgresTrophyCaseEditorService(publicTrophyService);
