CREATE TABLE "users" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL UNIQUE,
  "role" text NOT NULL
);

CREATE TABLE "tasks" (
  "id" text PRIMARY KEY,
  "title" text NOT NULL,
  "owner_id" text NOT NULL REFERENCES "users"("id"),
  "done" boolean NOT NULL
);
