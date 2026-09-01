export type AuthConfig =
  | { type: "none" }
  | { type: "userpass"; user: string; password: string }
  | { type: "token"; token: string }
  | { type: "creds"; creds: string };

export interface GatewayConfig {
  url: string;
  upstreamProfileId: string;
  token: string;
}

export interface ServerProfile {
  id: string;
  name: string;
  mode?: "nats" | "gateway";
  servers: string[];
  enabled: boolean;
  auth: AuthConfig;
  tls?: { ca?: string; cert?: string; key?: string; serverName?: string };
  gateway?: GatewayConfig;
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

export interface PublicProfile extends Omit<ServerProfile, "auth" | "tls" | "gateway" | "mode"> {
  mode: "nats" | "gateway";
  auth: { type: AuthConfig["type"]; user?: string; configured: boolean };
  tls: { configured: boolean; serverName?: string };
  gateway?: { url: string; upstreamProfileId: string; tokenConfigured: boolean };
}
