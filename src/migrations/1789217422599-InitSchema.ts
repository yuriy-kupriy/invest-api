import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1789217422599 implements MigrationInterface {
    name = 'InitSchema1789217422599'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`, ["invest","public","fx_rate","GENERATED_COLUMN","rate","(raw_rate / raw_units)::numeric(20,10)"]);
        await queryRunner.query(`CREATE TABLE "fx_rate" ("source" text NOT NULL, "currency" text NOT NULL, "rate_date" date NOT NULL, "raw_rate" numeric(20,10) NOT NULL, "raw_units" integer NOT NULL DEFAULT '1', "rate" numeric(20,10) GENERATED ALWAYS AS ((raw_rate / raw_units)::numeric(20,10)) STORED NOT NULL, "fetched_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "fx_rate_base_is_not_quoted" CHECK (currency <> 'UAH'), CONSTRAINT "fx_rate_raw_units_positive" CHECK (raw_units > 0), CONSTRAINT "fx_rate_raw_rate_positive" CHECK (raw_rate > 0), CONSTRAINT "fx_rate_source_length" CHECK (length(source) BETWEEN 1 AND 40), CONSTRAINT "PK_a492201b9d20e108aef6376dc41" PRIMARY KEY ("source", "currency", "rate_date"))`);
        await queryRunner.query(`CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" text NOT NULL, "kind" text NOT NULL, CONSTRAINT "UQ_8b0be371d28245da6e4f4b61878" UNIQUE ("name"), CONSTRAINT "categories_kind_enum" CHECK (kind IN ('income', 'expense')), CONSTRAINT "categories_name_length" CHECK (length(name) BETWEEN 1 AND 60), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "transactions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "account_id" uuid NOT NULL, "instrument_id" uuid, "category_id" uuid, "currency" text NOT NULL, "type" text NOT NULL, "status" text NOT NULL DEFAULT 'posted', "amount_cents" bigint NOT NULL, "fx_rate" numeric(20,10) NOT NULL DEFAULT '1', "quantity_micro" bigint, "unit_price" numeric(20,10), "booked_at" TIMESTAMP WITH TIME ZONE NOT NULL, "description" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "transactions_description_length" CHECK (length(description) <= 500), CONSTRAINT "transactions_unit_price_positive" CHECK (unit_price > 0), CONSTRAINT "transactions_quantity_positive" CHECK (quantity_micro > 0), CONSTRAINT "transactions_fx_rate_positive" CHECK (fx_rate > 0), CONSTRAINT "transactions_amount_non_negative" CHECK (amount_cents >= 0), CONSTRAINT "transactions_status_enum" CHECK (status IN ('pending', 'posted', 'failed')), CONSTRAINT "transactions_type_enum" CHECK (type IN ('income', 'expense', 'transfer_in', 'transfer_out', 'buy', 'sell')), CONSTRAINT "transactions_base_currency_rate_is_one" CHECK ((currency = 'UAH') = (fx_rate = 1)), CONSTRAINT "transactions_instrument_matches_type" CHECK ((type IN ('buy', 'sell')) = (instrument_id IS NOT NULL)), CONSTRAINT "PK_a219afd8dd77ed80f5a862f1db9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "instruments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "symbol" text NOT NULL, "name" text NOT NULL, "asset_class" text NOT NULL, "currency" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_8bd2da22a1ed32dced42f6a4f24" UNIQUE ("symbol"), CONSTRAINT "instruments_asset_class_enum" CHECK (asset_class IN ('equity', 'etf', 'bond', 'crypto')), CONSTRAINT "instruments_name_length" CHECK (length(name) BETWEEN 1 AND 120), CONSTRAINT "instruments_symbol_format" CHECK (symbol ~ '^[A-Z0-9.\\-]{1,20}$'), CONSTRAINT "PK_44d772c3199b38559c5fb666eb6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "currency" ("code" text NOT NULL, "numeric_code" smallint NOT NULL, "exponent" smallint NOT NULL, "name" text NOT NULL, CONSTRAINT "UQ_3daa5ac1db2dc8b8ac4b96a1986" UNIQUE ("numeric_code"), CONSTRAINT "currency_name_length" CHECK (length(name) BETWEEN 1 AND 80), CONSTRAINT "currency_exponent_range" CHECK (exponent BETWEEN 0 AND 6), CONSTRAINT "currency_numeric_code_range" CHECK (numeric_code BETWEEN 1 AND 999), CONSTRAINT "currency_code_format" CHECK (code ~ '^[A-Z]{3}$'), CONSTRAINT "PK_723472e41cae44beb0763f4039c" PRIMARY KEY ("code"))`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" text NOT NULL, "display_name" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "users_display_name_length" CHECK (length(display_name) BETWEEN 1 AND 120), CONSTRAINT "users_email_length" CHECK (length(email) BETWEEN 3 AND 254), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "currency" text NOT NULL, "name" text NOT NULL, "type" text NOT NULL, "balance_cents" bigint NOT NULL DEFAULT '0', "is_archived" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "accounts_type_enum" CHECK (type IN ('cash', 'bank', 'brokerage', 'property')), CONSTRAINT "accounts_name_length" CHECK (length(name) BETWEEN 1 AND 120), CONSTRAINT "PK_5a7a02c20412299d198e097a8fe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "fx_rate" ADD CONSTRAINT "FK_6751a85e439215da8f9e6d45c31" FOREIGN KEY ("currency") REFERENCES "currency"("code") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "transactions" ADD CONSTRAINT "FK_49c0d6e8ba4bfb5582000d851f0" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "transactions" ADD CONSTRAINT "FK_42ed1a8db981fc41615a0ef4cc3" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "transactions" ADD CONSTRAINT "FK_c9e41213ca42d50132ed7ab2b0f" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "transactions" ADD CONSTRAINT "FK_c3dd9222a377f7cdfc954fcf0cd" FOREIGN KEY ("currency") REFERENCES "currency"("code") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "instruments" ADD CONSTRAINT "FK_dc866badf89a0eabf14360cf91d" FOREIGN KEY ("currency") REFERENCES "currency"("code") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "accounts" ADD CONSTRAINT "FK_3000dad1da61b29953f07476324" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "accounts" ADD CONSTRAINT "FK_618a63a50985b99b283b3bead18" FOREIGN KEY ("currency") REFERENCES "currency"("code") ON DELETE NO ACTION ON UPDATE NO ACTION`);

        // The three indexes from db/indexes.sql (HW #12). The @Index decorators on
        // the entities carry `synchronize: false` precisely so migration:generate
        // leaves these alone — DESC ordering, WHERE, and lower() aren't expressible
        // through the decorator, so they're written by hand here instead.
        await queryRunner.query(`CREATE INDEX "transactions_account_booked_idx" ON "transactions" ("account_id", "booked_at" DESC, "id" DESC)`);
        await queryRunner.query(`CREATE INDEX "transactions_pending_booked_idx" ON "transactions" ("booked_at" DESC, "id") WHERE "status" = 'pending'`);
        await queryRunner.query(`CREATE INDEX "accounts_lower_name_idx" ON "accounts" (lower("name"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "accounts_lower_name_idx"`);
        await queryRunner.query(`DROP INDEX "transactions_pending_booked_idx"`);
        await queryRunner.query(`DROP INDEX "transactions_account_booked_idx"`);

        await queryRunner.query(`ALTER TABLE "accounts" DROP CONSTRAINT "FK_618a63a50985b99b283b3bead18"`);
        await queryRunner.query(`ALTER TABLE "accounts" DROP CONSTRAINT "FK_3000dad1da61b29953f07476324"`);
        await queryRunner.query(`ALTER TABLE "instruments" DROP CONSTRAINT "FK_dc866badf89a0eabf14360cf91d"`);
        await queryRunner.query(`ALTER TABLE "transactions" DROP CONSTRAINT "FK_c3dd9222a377f7cdfc954fcf0cd"`);
        await queryRunner.query(`ALTER TABLE "transactions" DROP CONSTRAINT "FK_c9e41213ca42d50132ed7ab2b0f"`);
        await queryRunner.query(`ALTER TABLE "transactions" DROP CONSTRAINT "FK_42ed1a8db981fc41615a0ef4cc3"`);
        await queryRunner.query(`ALTER TABLE "transactions" DROP CONSTRAINT "FK_49c0d6e8ba4bfb5582000d851f0"`);
        await queryRunner.query(`ALTER TABLE "fx_rate" DROP CONSTRAINT "FK_6751a85e439215da8f9e6d45c31"`);

        // Drop order mirrors FK dependency order (children before parents), even
        // though it isn't strictly required here since every FK is already gone.
        await queryRunner.query(`DROP TABLE "transactions"`);
        await queryRunner.query(`DROP TABLE "fx_rate"`);
        await queryRunner.query(`DROP TABLE "categories"`);
        await queryRunner.query(`DROP TABLE "instruments"`);
        await queryRunner.query(`DROP TABLE "accounts"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TABLE "currency"`);
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`, ["GENERATED_COLUMN","rate","invest","public","fx_rate"]);
    }

}
