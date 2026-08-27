export type AuthConfig =
  | { type: "none" }
  | { type: "userpass"; user: string; password: string }
  | { type: "token"; token: string }
  | { type: "creds"; creds: string };

export interface ServerProfile {
  id: string;
  name: string;
  servers: string[];
  enabled: boolean;
  auth: AuthConfig;
  tls?: { ca?: string; cert?: string; key?: string; serverName?: string };
}

export interface DecoderConfig {
  id: string;
  profileId: string;
  stream: string;
  name: string;
  script: string;
  enabled: boolean;
}

export interface AppConfig {
  profiles: ServerProfile[];
  decoders: DecoderConfig[];
}

export interface PublicProfile extends Omit<ServerProfile, "auth" | "tls"> {
  auth: { type: AuthConfig["type"]; user?: string; configured: boolean };
  tls: { configured: boolean; serverName?: string };
}
