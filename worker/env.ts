// Optional until configured. Public handlers fail closed without their own secrets.
export interface SnackEnv extends Pick<Env, 'DB' | 'ASSETS'> {
  SLACK_SIGNING_SECRET?: string;
  CALENDAR_SIGNING_KEY?: string;
  PUBLIC_ORIGIN?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_BOT_WORKSPACE_ID?: string;
}
