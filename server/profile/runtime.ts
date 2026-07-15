import {
  PostgresPublicProfileService,
  PostgresPublicTrophyService,
  PostgresTrophyCaseEditorService,
} from "./profile-service";

export const publicTrophyService = new PostgresPublicTrophyService();
export const profileService = new PostgresPublicProfileService(publicTrophyService);
export const editorService = new PostgresTrophyCaseEditorService(publicTrophyService);
