import { Module } from "@nestjs/common";

import { openDatabase, type Db } from "./connection";

/** The injection token for the shared database handle. */
export const DB = Symbol("DB");

@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db => openDatabase({ path: process.env.DB_PATH ?? "./cashback.db" }),
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
