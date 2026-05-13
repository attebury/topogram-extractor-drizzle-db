import { boolean, index, pgTable, text, unique } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["user", "admin"] }).notNull()
}, (table) => ({
  emailIdx: unique("users_email_unique").on(table.email)
}));

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id),
  done: boolean("done").notNull()
}, (table) => ({
  ownerIdx: index("tasks_owner_id_idx").on(table.ownerId)
}));
