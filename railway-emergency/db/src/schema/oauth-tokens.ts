import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const oauthTokensTable = pgTable("oauth_tokens", {
  id:           serial("id").primaryKey(),
  provider:     text("provider").notNull().unique(),
  accessToken:  text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt:    timestamp("expires_at"),
  scope:        text("scope"),
  updatedAt:    timestamp("updated_at").defaultNow(),
});

export type OauthToken = typeof oauthTokensTable.$inferSelect;
